import * as utils from "@iobroker/adapter-core";
import * as SunCalc from "suncalc";
import webpush from "web-push";
import {
  createEngine,
  type Engine,
  type LogicReading,
  type StateChange,
} from "./logic/engine";
import { isRecord, parseLogicDocument } from "./logic/validate";
import { subscriptionDiff } from "./logic/subscriptions";
import {
  stateCommonDiff,
  stateObjectWithDiff,
  type StateSpec,
} from "./logic/state-common";
import { logicOutputSpec, numberStatesOf } from "./logic/state-specs";
import type { AstroEvent, LogicDocument } from "./logic/types";
import { createLogBuffer } from "./log-buffer";
import { NetworkPresenceService } from "./network-presence";
import { validNetworkDevices } from "./logic/network-ops";
import { createPluginApi } from "./plugin-api";
import {
  applyPluginPatches,
  parsePluginsCommand,
  pluginView as makePluginView,
  type PluginView,
  type PluginsCommand,
} from "./plugin-admin";
import {
  importStaged,
  mergePluginSettings,
  normalizeSettingsDoc,
  pluginSettingsChanged,
  pluginSettingsDoc,
  removeStaged,
  stageRemoval,
  type PluginSettingsDocument,
} from "./plugin-config";
import {
  parsePluginFile,
  pluginFile,
  type ImportedPlugin,
} from "./plugin-file";
import { createPluginHost, type PluginHost } from "./plugin-host";
import {
  BUILTIN_PLUGINS,
  DEFAULT_PLUGIN_TIMEOUT_MS,
  parsePluginMessage,
  pluginConfigWithBuiltins,
  pluginError,
  pluginReply,
  seedBuiltinPlugins,
  type AdapterPlugin,
  type PluginReply,
} from "./plugin-ops";
import { createNetworkPlugins } from "./plugins/network";
import {
  locationText,
  mapUrl,
  normalizeConnection,
  validDeviceId,
  validHome,
  validLocation,
  validPhoneName,
} from "./logic/phone-ops";
import {
  ensureVapidKeys,
  normalizePushPayload,
  pushStatePayload,
  removePushSubscription,
  sendPushes,
  upsertPushSubscription,
  validPushPayload,
  validPushSubscription,
  type PushPayload,
  type PushSubscriptionRecord,
} from "./push-ops";
import { uiMessage } from "./ui-message";

// JSON documents the dashboard reads and writes. The adapter owns the objects;
// the SPA (served by the web adapter at /ihome/) edits the values. Everything
// lives in a subfolder so the instance root stays free for adapter logic.
// `settings` is the shared settings document (PIN and future UI/behaviour
// settings), not a dashboard document — the same folder keeps one owner.
const CONFIG_FOLDER = "config";
const DOCS = [
  "pageList",
  "deviceList",
  "templateList",
  "formulaList",
  "variableList",
  "settings",
  "logicList",
  "pluginSettings",
] as const;

// Data of the pre-adapter test namespace; copied once, then left untouched.
const LEGACY_PREFIX = "0_userdata.0.Test.AiHome.";

/** How often the adapter logs that it is still alive. */
const HEARTBEAT_MS = 10 * 60 * 1000;

interface VariableInput {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  unit?: unknown;
  kind?: unknown;
  stateId?: unknown;
  value?: unknown;
}

interface VariableDoc {
  variables?: VariableInput[];
}

interface VariableEntry {
  id: string;
  name: string;
  type: string;
  unit?: string;
}

interface ConstantEntry extends VariableEntry {
  val: unknown;
}

interface StateEntry extends VariableEntry {
  stateId: string;
}

interface Variables {
  constants: Record<string, ConstantEntry>;
  states: Record<string, StateEntry>;
}

/**
 * The SPA seeds an empty page document when it cannot read one yet (e.g. the
 * dashboard was opened before this migration ran, or a browser still holds the
 * old bundle). Such a placeholder counts as empty here — otherwise the real
 * documents could never come across. A document with any tile is never touched.
 */
function isPlaceholder(val: unknown): boolean {
  try {
    const doc = (typeof val === "string" ? JSON.parse(val) : val) as {
      seeded?: unknown;
      pages?: unknown;
    } | null;
    if (!doc || doc.seeded !== true || !Array.isArray(doc.pages)) return false;
    return !doc.pages.some((p: any) =>
      (p?.groups ?? []).some((g: any) => (g?.tiles ?? []).length),
    );
  } catch {
    return false;
  }
}

/**
 * A logic write as the target state's declared type. ioBroker coerces too, but
 * an explicit conversion keeps the engine's last-written value comparable.
 */
function coerceStateValue(value: unknown, type?: string): unknown {
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === "boolean") return Boolean(value);
  if (type === "string") return String(value);
  return value;
}

/**
 * A constant's stored text as its declared type; `undefined` when it cannot be
 * read as that type.
 *
 * shortcut: this mirrors the SPA's `convertValue()` in
 * src/lib/config/variables.ts — unify both if a third consumer appears.
 */
function constantValue(v: VariableInput): unknown {
  const raw = String(v.value ?? "");
  if (v.type === "number") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  if (v.type === "boolean") {
    const s = raw.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(s)) return true;
    if (["false", "0", "off", "no"].includes(s)) return false;
    return undefined;
  }
  return raw;
}

class IHome extends utils.Adapter {
  /**
   * The config's global variables, materialised in memory when the config
   * loads — never broker objects, nothing to update:
   *   constants: name -> { id, name, type, unit, val }  iHome-internal values
   *   states:    name -> { id, name, type, unit, stateId }  broker references
   * The SPA builds the same two views from the same document (see
   * src/lib/config/variables.ts and src/lib/stores/variables.svelte.ts).
   */
  private variables: Variables = { constants: {}, states: {} };
  private engine?: Engine;
  /** External ids the current engine subscribes to (for unsubscribing). */
  private logicIds: string[] = [];
  /** Last seen state per logic-referenced id; `read` never awaits. */
  private logicValues = new Map<string, StateChange>();
  /** `common.type` of a referenced state, for writes. */
  private stateTypes = new Map<string, string>();
  /** `common.write` of a referenced state; read-only targets are never written. */
  private stateWritable = new Map<string, boolean>();
  private warnedWrites = new Set<string>();
  /** Guards overlapping reloads: only the newest may swap the engine. */
  private logicLoad = 0;
  /** The system location for astro timers, read once. */
  private astroConfig?: { lat: number; lon: number };
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly startedAt = Date.now();
  /** The adapter's recent log lines, published as `info.log`. */
  private readonly logs = createLogBuffer();
  private logStateTimer?: ReturnType<typeof setTimeout>;
  /** Logic messages for live toasts, published as `info.messages`. */
  private readonly messages = createLogBuffer(20);
  private messageStateTimer?: ReturnType<typeof setTimeout>;
  /** Web Push subscriptions, mirrored in `info.pushSubscriptions`. */
  private pushSubscriptions: PushSubscriptionRecord[] = [];
  private pushPublicKey = "";
  private pushPrivateKey = "";
  /** The live readout per logic, published as `info.logic`. */
  private readonly logicInfo = new Map<string, LogicReading>();
  private logicStateTimer?: ReturnType<typeof setTimeout>;
  /** The LAN presence pollers configured under native.networkDevices. */
  private networkPresence?: NetworkPresenceService;
  /** The admin-managed adapter-side plugins. */
  private pluginHost?: PluginHost;
  /** The plugin list as the adapter currently knows it. */
  private pluginConfig: AdapterPlugin[] = [];
  /** Page-managed plugin settings, staged imports and removals. */
  private pluginSettings: PluginSettingsDocument = {
    version: 1,
    settings: {},
    staged: [],
    removals: [],
  };
  /** The last settings document this adapter wrote, to ignore its own echo. */
  private pluginSettingsText = "";
  /** Serializes plugin management commands. */
  private pluginsTail: Promise<unknown> = Promise.resolve();

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "ihome" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("log", (entry: ioBroker.LogMessage) => this.onLog(entry));
    this.on("message", (obj) => {
      if (obj.command === "phone") void this.onPhoneMessage(obj);
      else if (obj.command === "push") void this.onPushMessage(obj);
      else if (obj.command === "notify") void this.onNotifyMessage(obj);
      else if (obj.command === "plugin") void this.onPluginMessage(obj);
      else if (obj.command === "plugins") void this.onPluginsMessage(obj);
    });
  }

  /**
   * Adapter lines from the controller. Logic lines are pushed where they are
   * produced (deps.log), so they are skipped here. A log transporter sees its
   * own lines with the `ihome.0 ` prefix and, on some versions, no `from`.
   */
  private onLog(entry: ioBroker.LogMessage): void {
    const message = String(entry.message ?? "");
    const own =
      entry.from === this.namespace ||
      entry.from === `system.adapter.${this.namespace}` ||
      message.startsWith(`${this.namespace} `);
    if (!own || message.includes("[logic ")) return;
    this.logs.push({
      ts: Number(entry.ts) || Date.now(),
      from: this.namespace,
      severity: String(entry.severity ?? "info"),
      message: message.replace(
        new RegExp(`^${this.namespace} (?:\\(\\d+\\) )?`),
        "",
      ),
    });
    this.scheduleLogState();
  }

  /**
   * Publish the ring as a state (debounced). `getState` works on every
   * transport; `sendTo` replies did not.
   */
  private scheduleLogState(): void {
    if (this.logStateTimer) return;
    this.logStateTimer = setTimeout(() => {
      this.logStateTimer = undefined;
      void this.setStateAsync("info.log", {
        val: JSON.stringify(this.logs.slice(0, 200)),
        ack: true,
      }).catch(() => {});
    }, 500);
  }

  /** Push a logic line to the log feed and the adapter log. */
  private pushLogicLog(
    level: "info" | "warn" | "error",
    logicId: string,
    message: string,
  ): void {
    const line = `[logic ${logicId}] ${message}`;
    this.logs.push({
      ts: Date.now(),
      from: this.namespace,
      severity: level,
      message: line,
    });
    this.scheduleLogState();
    if (level === "error") this.log.error(line);
    else if (level === "warn") this.log.warn(line);
    else this.log.info(line);
  }

  /** Publish a logic message for live toasts and log it. */
  private pushMessage(
    level: "info" | "warn" | "error",
    logicId: string,
    message: string,
    timeout?: number,
  ): void {
    this.pushLogicLog(level, logicId, message);
    this.messages.push({
      ts: Date.now(),
      from: logicId,
      severity: level,
      message,
      timeout,
    });
    this.scheduleMessageState();
  }

  /** Log a logic notification and send it to every subscribed phone. */
  private notifyLogic(
    level: "info" | "warn" | "error",
    logicId: string,
    title: string,
    body: string,
  ): void {
    const payload = normalizePushPayload({ title, body, level });
    this.pushLogicLog(level, logicId, payload.body || payload.title);
    void this.sendPush(payload).catch((error) => {
      this.log.warn(`push notify failed: ${String(error)}`);
    });
  }

  /** Publish the message ring as a state (debounced, like `info.log`). */
  private scheduleMessageState(): void {
    if (this.messageStateTimer) return;
    this.messageStateTimer = setTimeout(() => {
      this.messageStateTimer = undefined;
      void this.setStateAsync("info.messages", {
        val: JSON.stringify(this.messages.slice(0, 20)),
        ack: true,
      }).catch(() => {});
    }, 200);
  }

  /** Publish the live logic readout as a state (debounced, like `info.log`). */
  private scheduleLogicState(): void {
    if (this.logicStateTimer) return;
    this.logicStateTimer = setTimeout(() => {
      this.logicStateTimer = undefined;
      void this.setStateAsync("info.logic", {
        val: JSON.stringify({
          ts: Date.now(),
          logics: Object.fromEntries(this.logicInfo),
        }),
        ack: true,
      }).catch(() => {});
    }, 500);
  }

  /**
   * Rebuild the in-memory variables from the config document. Called once the
   * config is loaded and again whenever the SPA edits the list.
   */
  private async loadVariables(): Promise<void> {
    this.log.debug(`Loading ${CONFIG_FOLDER}.variableList`);
    const st = await this.getStateAsync(`${CONFIG_FOLDER}.variableList`);
    let doc: unknown = st?.val;
    if (typeof doc === "string") {
      try {
        doc = JSON.parse(doc);
      } catch {
        this.log.debug(`${CONFIG_FOLDER}.variableList is not valid JSON`);
        doc = null;
      }
    }
    const list =
      doc &&
      typeof doc === "object" &&
      Array.isArray((doc as VariableDoc).variables)
        ? ((doc as VariableDoc).variables as VariableInput[])
        : [];
    const constants: Record<string, ConstantEntry> = {};
    const states: Record<string, StateEntry> = {};
    for (const v of list) {
      if (!v || typeof v.id !== "string") continue;
      const entry: VariableEntry = {
        id: v.id,
        name: String(v.name ?? v.id),
        type: String(v.type ?? "string"),
        unit: v.unit == null ? undefined : String(v.unit),
      };
      if (v.kind === "state" && typeof v.stateId === "string") {
        states[entry.name] = { ...entry, stateId: v.stateId };
      } else {
        constants[entry.name] = { ...entry, val: constantValue(v) };
      }
    }
    this.variables = { constants, states };
    this.log.debug(
      `Variables loaded: ${Object.keys(constants).length} constant(s), ` +
        `${Object.keys(states).length} state reference(s)`,
    );
  }

  /**
   * Create a missing owned state or update only the common keys that differ.
   * An equal object is left completely untouched (no ioBroker churn).
   */
  private async ensureOwnState(spec: StateSpec): Promise<void> {
    const existing = await this.getObjectAsync(spec.id);
    if (!existing) {
      await this.setObjectNotExistsAsync(spec.id, {
        type: "state",
        common: spec.common as unknown as ioBroker.StateCommon,
        native: {},
      });
      return;
    }
    const diff = stateCommonDiff(
      existing.common as Record<string, unknown>,
      spec.common,
    );
    if (diff) {
      await this.setObjectAsync(
        spec.id,
        stateObjectWithDiff(
          existing as unknown as Record<string, unknown>,
          diff,
        ) as unknown as ioBroker.Object,
      );
    }
  }

  /**
   * The logic states the adapter owns: `<namespace>.Logic.<logic id>`. Created
   * on demand and kept in step with the document; a state whose logic no longer
   * has a logic output is pruned. A logic output is a command, so the role is
   * level.switch (binary) or level.state — never `value`, which the ecosystem
   * reserves for read-only sensor readings.
   */
  private async ensureLogicStates(doc: LogicDocument): Promise<void> {
    const own = doc.logics.filter((def) => def.output?.scope === "logic");
    if (own.length > 0) {
      try {
        await this.setObjectNotExistsAsync("Logic", {
          type: "folder",
          common: { name: "Logic" },
          native: {},
        });
      } catch (error) {
        this.log.warn(`logic: cannot ensure the Logic folder: ${error}`);
      }

      for (const def of own) {
        const spec = logicOutputSpec(def, this.namespace);
        if (!spec) continue;
        try {
          await this.ensureOwnState(spec);
        } catch (error) {
          this.log.warn(`logic: cannot ensure ${spec.id}: ${error}`);
        }
      }
    }

    // A logic that was deleted, renamed or switched away from an ihome state
    // leaves its old state behind; remove those, the folder is ours (D21).
    await this.pruneLogicStates(new Set(own.map((def) => `Logic.${def.id}`)));

    // A foreign number target gets the state labels too — only when it has none,
    // the owner's object is never overwritten.
    for (const def of doc.logics) {
      const output = def.output;
      if (output?.scope !== "state" || output.type !== "number") continue;
      const states = numberStatesOf(def);
      if (!states) continue;
      const id = output.ref.includes(".")
        ? output.ref
        : this.variables.states[output.ref]?.stateId;
      if (!id) continue;
      const isOwn = id.startsWith(`${this.namespace}.`);
      try {
        if (isOwn) {
          const obj = await this.getObjectAsync(id);
          if (
            !obj ||
            (obj.common?.states && Object.keys(obj.common.states).length > 0)
          )
            continue;
          await this.extendObjectAsync(id, { common: { states } });
        } else {
          const obj = await this.getForeignObjectAsync(id);
          if (
            !obj ||
            (obj.common?.states && Object.keys(obj.common.states).length > 0)
          )
            continue;
          await this.extendForeignObjectAsync(id, { common: { states } });
        }
      } catch (error) {
        this.log.warn(`logic: cannot publish states for ${id}: ${error}`);
      }
    }
  }

  /** Remove direct state children of the Logic folder that no logic owns. */
  private async pruneLogicStates(keep: Set<string>): Promise<void> {
    let rows: { id: string; value?: { type?: string } }[] = [];
    try {
      const list = await this.getObjectListAsync({
        startkey: "Logic.",
        endkey: "Logic.\u9999",
      });
      rows = (list.rows ?? []).map((row) => ({
        id: row.id,
        value: row.value as { type?: string },
      }));
    } catch (error) {
      this.log.warn(`logic: cannot list the Logic folder: ${error}`);
      return;
    }
    for (const row of rows) {
      if (keep.has(row.id)) continue;
      if (row.id.split(".").length !== 2) continue; // direct children only
      if (row.value?.type !== "state") continue;
      try {
        await this.delStateAsync(row.id).catch(() => undefined);
        await this.delObjectAsync(row.id);
        this.log.info(
          `logic: removed orphan state ${this.namespace}.${row.id}`,
        );
      } catch (error) {
        this.log.warn(
          `logic: cannot remove ${this.namespace}.${row.id}: ${error}`,
        );
      }
    }
  }

  /** Read the system latitude/longitude once; astro timers need both. */
  private async ensureAstroConfig(): Promise<void> {
    if (this.astroConfig) return;
    try {
      const config = await this.getForeignObjectAsync("system.config");
      const lat = Number(config?.common?.latitude);
      const lon = Number(config?.common?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        this.astroConfig = { lat, lon };
      } else {
        this.log.warn(
          "logic: system.config has no latitude/longitude — astro timers are skipped",
        );
      }
    } catch (error) {
      this.log.warn(`logic: cannot read system.config for astro: ${error}`);
    }
  }

  /** The next occurrence of an astro time (local) after `from`, plus offset. */
  private nextAstro(
    event: AstroEvent,
    offset: number,
    from: number,
  ): number | undefined {
    if (!this.astroConfig) return undefined;
    const { lat, lon } = this.astroConfig;
    const day = new Date(from);
    for (let attempt = 0; attempt < 2; attempt++) {
      const times = SunCalc.getTimes(day, lat, lon);
      const at = times[event] as Date | undefined;
      if (at && Number.isFinite(at.getTime())) {
        const target = at.getTime() + offset * 60_000;
        if (target > from) return target;
      }
      day.setDate(day.getDate() + 1);
    }
    return undefined;
  }

  /**
   * The logic engine (spec 2026-10-31). Reads its document, subscribes exactly
   * the refs it names, then swaps engines so a reload never leaves a gap with
   * the old timers still armed. An unreadable or newer document leaves the
   * running engine untouched.
   */
  private async loadLogics(): Promise<void> {
    const loadId = ++this.logicLoad;
    const target = `${CONFIG_FOLDER}.logicList`;
    let doc: LogicDocument | null = { version: 3, logics: [] };
    try {
      const stored = await this.getStateAsync(target);
      const raw = stored?.val;
      if (raw != null && raw !== "") {
        doc = parseLogicDocument(raw);
        if (!doc) {
          this.log.warn(
            `${target} is unreadable or newer than this adapter — keeping the running logic engine`,
          );
          return;
        }
      }
    } catch (error) {
      this.log.warn(`cannot read ${target}: ${error}`);
      return;
    }
    if (loadId !== this.logicLoad) return; // a newer reload won
    if (!doc) return;

    await this.ensureAstroConfig();
    await this.ensureLogicStates(doc);

    let next: Engine;
    try {
      next = createEngine(
        doc,
        {
          read: (id) => this.logicValues.get(id)?.val,
          readState: (id) => this.logicValues.get(id),
          write: (id, value, ack) => this.writeLogicState(id, value, ack),
          log: (level, logicId, message) =>
            this.pushLogicLog(level, logicId, message),
          message: (level, logicId, message, timeout) =>
            this.pushMessage(level, logicId, message, timeout),
          notify: (level, logicId, title, body) =>
            this.notifyLogic(level, logicId, title, body),
          now: () => Date.now(),
          setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
          clearTimeout: (handle) =>
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
          report: (logicId, reading) => {
            this.logicInfo.set(logicId, reading);
            this.scheduleLogicState();
          },
          resolveVariable: (name) => {
            const constant = this.variables.constants[name];
            if (constant) return { kind: "const", value: constant.val };
            const variable = this.variables.states[name];
            if (variable) return { kind: "state", stateId: variable.stateId };
            return undefined;
          },
          callPlugin: (id, payload) =>
            this.pluginHost?.call(id, payload) ??
            Promise.resolve(pluginError("plugins are not available")),
          nextAstro: (event, offset, from) =>
            this.nextAstro(event, offset, from),
        },
        { ownFrom: this.namespace },
      );
    } catch (error) {
      this.log.warn(`logic engine not rebuilt: ${error}`);
      return;
    }

    const ids = next.subscriptions();
    // Anything a removed/disabled logic or a deleted variable no longer names
    // is unsubscribed here, so the broker stops sending it and nothing keeps
    // running for it.
    // Subscribe before warming: a change between the two is then delivered
    // instead of being lost and leaving the engine on a stale value.
    const diff = subscriptionDiff(this.logicIds, ids, this.namespace);
    try {
      if (diff.own.add.length) await this.subscribeStatesAsync(diff.own.add);
      if (diff.foreign.add.length) {
        await this.subscribeForeignStatesAsync(diff.foreign.add);
      }
      if (diff.own.remove.length) {
        await this.unsubscribeStatesAsync(diff.own.remove);
      }
      if (diff.foreign.remove.length) {
        await this.unsubscribeForeignStatesAsync(diff.foreign.remove);
      }
    } catch (error) {
      // Keeping the old engine is better than running one that gets no events.
      this.log.warn(
        `logic subscriptions — keeping the running engine: ${error}`,
      );
      return;
    }
    if (loadId !== this.logicLoad) return;

    await this.warmLogicCache(ids);
    if (loadId !== this.logicLoad) return;

    const missing = ids.filter((id) => !this.logicValues.has(id));
    for (const id of missing) {
      this.log.warn(
        `logic: ${id} does not exist — the logic cannot react to it`,
      );
    }

    try {
      this.logicInfo.clear();
      next.start();
      this.scheduleLogicState();
    } catch (error) {
      next.stop();
      this.log.warn(
        `logic engine failed to start — keeping the running one: ${error}`,
      );
      return;
    }

    this.engine?.stop();
    this.logicIds = ids;
    this.engine = next;
    const active = doc.logics.filter((logic) => logic.enabled !== false).length;
    this.log.info(
      `Logic engine: ${doc.logics.length} logic(s) (${active} active), ${ids.length} subscribed state(s)`,
    );
  }

  /** Fill the engine's read cache before it starts; reads then never await. */
  private async warmLogicCache(ids: string[]): Promise<void> {
    const isOwn = (id: string) => id.startsWith(`${this.namespace}.`);
    await Promise.all(
      ids.map(async (id) => {
        try {
          const state = isOwn(id)
            ? await this.getStateAsync(id)
            : await this.getForeignStateAsync(id);
          if (state) {
            this.logicValues.set(id, {
              id,
              val: state.val,
              ack: state.ack,
              from: state.from,
              ts: state.ts,
              changed: false,
            });
          }
        } catch (error) {
          this.log.debug(`logic: cannot read ${id}: ${error}`);
        }
        try {
          const object = isOwn(id)
            ? await this.getObjectAsync(id)
            : await this.getForeignObjectAsync(id);
          const common = (object?.common ?? undefined) as
            { type?: string; write?: boolean } | undefined;
          if (common?.type) this.stateTypes.set(id, common.type);
          if (common) this.stateWritable.set(id, common.write !== false);
        } catch {
          // a state without an object keeps its value type
        }
      }),
    );
  }

  private writeLogicState(id: string, value: unknown, ack: boolean): void {
    if (this.stateWritable.get(id) === false) {
      if (!this.warnedWrites.has(id)) {
        this.warnedWrites.add(id);
        this.log.warn(
          `logic: refusing to write ${id} — the state is read-only`,
        );
      }
      return;
    }
    const state = {
      val: coerceStateValue(value, this.stateTypes.get(id)) as never,
      ack,
      // Short, stable origin for other adapters/scripts and the engine's
      // self-attribution (the SPA and the JS adapter both see it).
      from: this.namespace,
    };
    const fail = (error: unknown) =>
      this.log.warn(`logic: cannot write ${id}: ${error}`);
    if (id.startsWith(`${this.namespace}.`)) {
      this.setStateAsync(id, state).catch(fail);
    } else {
      this.setForeignStateAsync(id, state).catch(fail);
    }
  }

  /** Create the phone folder, home point and one device's state objects. */
  private async ensurePhoneStates(
    deviceId: string,
    name: string,
  ): Promise<void> {
    await this.setObjectNotExistsAsync("phone", {
      type: "folder",
      common: { name: "Phone presence" },
      native: {},
    });
    await this.setObjectNotExistsAsync(`phone.${deviceId}`, {
      type: "folder",
      common: { name },
      native: {},
    });
    const states: Array<{
      field: string;
      name: string;
      type: "string" | "boolean" | "number";
      role: string;
      unit?: string;
    }> = [
      { field: "name", name: "Name", type: "string", role: "text" },
      { field: "enabled", name: "Enabled", type: "boolean", role: "switch" },
      {
        field: "atHome",
        name: "At home",
        type: "boolean",
        role: "indicator.state",
      },
      {
        field: "homeSource",
        name: "Home source",
        type: "string",
        role: "text",
      },
      {
        field: "location",
        name: "Location",
        type: "string",
        role: "text.json",
      },
      {
        field: "locationText",
        name: "Location text",
        type: "string",
        role: "text",
      },
      { field: "mapUrl", name: "Map link", type: "string", role: "text" },
      {
        field: "distance",
        name: "Distance from home",
        type: "number",
        role: "value",
        unit: "m",
      },
      {
        field: "online",
        name: "Online",
        type: "boolean",
        role: "indicator.state",
      },
      { field: "connection", name: "Connection", type: "string", role: "text" },
      {
        field: "local",
        name: "Local network",
        type: "boolean",
        role: "indicator.state",
      },
      {
        field: "permission",
        name: "Location permission",
        type: "string",
        role: "text",
      },
      {
        field: "lastSeen",
        name: "Last seen",
        type: "number",
        role: "value.time",
      },
      {
        field: "updatedAt",
        name: "Updated",
        type: "number",
        role: "value.time",
      },
    ];
    for (const state of states) {
      await this.setObjectNotExistsAsync(`phone.${deviceId}.${state.field}`, {
        type: "state",
        common: {
          name: state.name,
          type: state.type,
          role: state.role as never,
          read: true,
          write: false,
          ...(state.unit ? { unit: state.unit } : {}),
        },
        native: {},
      });
    }
  }

  private async removePhoneDevice(deviceId: string): Promise<void> {
    const fields = [
      "name",
      "enabled",
      "atHome",
      "homeSource",
      "location",
      "locationText",
      "mapUrl",
      "distance",
      "online",
      "connection",
      "local",
      "permission",
      "lastSeen",
      "updatedAt",
    ];
    for (const field of fields) {
      try {
        await this.delObjectAsync(`phone.${deviceId}.${field}`);
      } catch {
        // already gone
      }
    }
    try {
      await this.delObjectAsync(`phone.${deviceId}`);
    } catch {
      // already gone
    }
    const before = this.pushSubscriptions.length;
    this.pushSubscriptions = removePushSubscription(
      this.pushSubscriptions,
      deviceId,
    );
    if (this.pushSubscriptions.length !== before) {
      await this.writePushSubscriptions();
    }
  }

  /** Write the phone fields the SPA sent; validation rejects bad values. */
  private async writePhoneUpdate(
    deviceId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const prefix = `phone.${deviceId}.`;
    const write = (field: string, val: unknown): Promise<unknown> =>
      this.setStateAsync(`${prefix}${field}`, {
        val: val as ioBroker.StateValue,
        ack: true,
      });

    const name =
      data.name === undefined ? undefined : validPhoneName(data.name);
    if (data.name !== undefined) {
      if (!name) throw new Error("invalid phone name");
      await write("name", name);
    }
    if (data.enabled !== undefined) {
      if (typeof data.enabled !== "boolean") throw new Error("invalid enabled");
      await write("enabled", data.enabled);
    }
    if (data.atHome !== undefined) {
      if (data.atHome !== null && typeof data.atHome !== "boolean") {
        throw new Error("invalid atHome");
      }
      await write("atHome", data.atHome);
    }
    if (data.homeSource !== undefined) {
      if (
        typeof data.homeSource !== "string" ||
        !["local", "geofence", "none"].includes(data.homeSource)
      ) {
        throw new Error("invalid homeSource");
      }
      await write("homeSource", data.homeSource);
    }

    const atHome = data.atHome === true;
    if (atHome) {
      await write("location", "");
      await write("locationText", "At home");
      await write("mapUrl", "");
    } else if (data.location !== undefined) {
      if (data.location === null) {
        await write("location", "");
        await write("locationText", "Unknown");
        await write("mapUrl", "");
      } else {
        const location = validLocation(data.location);
        if (!location) throw new Error("invalid location");
        await write("location", JSON.stringify(location));
        await write("locationText", locationText(location, false));
        await write("mapUrl", mapUrl(location));
      }
    }
    if (data.locationText !== undefined) {
      if (
        typeof data.locationText !== "string" ||
        data.locationText.length > 200
      ) {
        throw new Error("invalid locationText");
      }
      await write("locationText", data.locationText);
    }
    if (data.mapUrl !== undefined) {
      if (typeof data.mapUrl !== "string" || data.mapUrl.length > 500) {
        throw new Error("invalid mapUrl");
      }
      await write("mapUrl", data.mapUrl);
    }
    if (data.distance !== undefined) {
      if (
        data.distance !== null &&
        (typeof data.distance !== "number" ||
          !Number.isFinite(data.distance) ||
          data.distance < 0)
      ) {
        throw new Error("invalid distance");
      }
      await write("distance", data.distance);
    }
    if (data.online !== undefined) {
      if (typeof data.online !== "boolean") throw new Error("invalid online");
      await write("online", data.online);
    }
    if (data.connection !== undefined) {
      if (typeof data.connection !== "string")
        throw new Error("invalid connection");
      await write("connection", normalizeConnection({ type: data.connection }));
    }
    if (data.local !== undefined) {
      if (typeof data.local !== "boolean") throw new Error("invalid local");
      await write("local", data.local);
    }
    if (data.permission !== undefined) {
      if (
        typeof data.permission !== "string" ||
        !["granted", "denied", "prompt", "unsupported"].includes(
          data.permission,
        )
      ) {
        throw new Error("invalid permission");
      }
      await write("permission", data.permission);
    }
    const now = Date.now();
    await write(
      "lastSeen",
      typeof data.lastSeen === "number" && Number.isFinite(data.lastSeen)
        ? data.lastSeen
        : now,
    );
    await write("updatedAt", now);
  }

  private async onPluginMessage(obj: ioBroker.Message): Promise<void> {
    if (obj.command !== "plugin") return;
    const reply = (result: PluginReply): void => {
      if (obj.callback)
        this.sendTo(obj.from, obj.command, result, obj.callback);
    };
    const parsed = parsePluginMessage(obj.message);
    if (!parsed.ok) return reply(pluginError(parsed.error));
    if (!this.pluginHost)
      return reply(pluginError("plugins are not available"));
    reply(
      await this.pluginHost.call(parsed.message.id, parsed.message.payload),
    );
  }

  private pluginSettingsStateId(): string {
    return `${this.namespace}.${CONFIG_FOLDER}.pluginSettings`;
  }

  private async readPluginSettings(): Promise<PluginSettingsDocument | null> {
    const state = await this.getStateAsync(this.pluginSettingsStateId());
    return normalizeSettingsDoc(state?.val);
  }

  private async savePluginSettings(): Promise<void> {
    const text = JSON.stringify(this.pluginSettings);
    this.pluginSettingsText = text;
    await this.setStateAsync(this.pluginSettingsStateId(), {
      val: text,
      ack: true,
    });
  }

  private async applyPluginSettings(
    doc: PluginSettingsDocument,
    text = JSON.stringify(doc),
  ): Promise<void> {
    const previous = this.pluginConfig;
    const next = mergePluginSettings(previous, doc);
    const host = this.pluginHost;
    for (const plugin of next) {
      const old = previous.find((entry) => entry.id === plugin.id);
      if (!old) continue;
      if (old.enabled !== plugin.enabled) await host?.setEnabled(plugin);
      if (pluginSettingsChanged(old.settings, plugin.settings)) {
        await host?.updateSettings(plugin.id, plugin.settings ?? {});
      }
      if (old.timeoutMs !== plugin.timeoutMs || old.debug !== plugin.debug) {
        host?.updateMeta(plugin.id, {
          timeoutMs: plugin.timeoutMs,
          debug: plugin.debug,
        });
      }
    }
    for (const id of doc.removals) {
      const old = previous.find((entry) => entry.id === id);
      if (old?.enabled) await host?.setEnabled({ ...old, enabled: false });
    }
    this.pluginConfig = next;
    this.pluginSettings = doc;
    this.pluginSettingsText = text;
  }

  private pluginViewOf(plugin: AdapterPlugin): PluginView {
    const host = this.pluginHost;
    const restartRequired =
      this.pluginSettings.staged.some((entry) => entry.id === plugin.id) ||
      this.pluginSettings.removals.includes(plugin.id) ||
      !host ||
      !host.canHotEnable(plugin.id, plugin.code) ||
      host.needsSettingsRestart(plugin.id);
    const status = restartRequired
      ? "restart-required"
      : (host?.status(plugin.id) ?? "disabled");
    return makePluginView(plugin, {
      status,
      hotSettings: host?.hasReload(plugin.id) ?? false,
      restartRequired,
    });
  }

  private pluginViews(): PluginView[] {
    const activeIds = new Set(this.pluginConfig.map((plugin) => plugin.id));
    const views = this.pluginConfig.map((plugin) => this.pluginViewOf(plugin));
    for (const imported of this.pluginSettings.staged) {
      if (activeIds.has(imported.id)) continue;
      views.push(
        makePluginView(
          {
            id: imported.id,
            name: imported.name,
            enabled: false,
            builtin: false,
            timeoutMs: imported.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
            debug: false,
            ...(imported.help ? { help: imported.help } : {}),
            ...(imported.usage ? { usage: imported.usage } : {}),
            ...(imported.settings ? { settings: imported.settings } : {}),
            ...(imported.settingsSchema
              ? { settingsSchema: imported.settingsSchema }
              : {}),
            code: imported.code,
          },
          {
            status: "restart-required",
            hotSettings: false,
            restartRequired: true,
          },
        ),
      );
    }
    return views;
  }

  private async onPluginsMessage(obj: ioBroker.Message): Promise<void> {
    if (obj.command !== "plugins") return;
    const reply = (result: PluginReply): void => {
      if (obj.callback)
        this.sendTo(obj.from, obj.command, result, obj.callback);
    };
    const parsed = parsePluginsCommand(obj.message);
    if ("problem" in parsed) return reply(pluginError(parsed.problem));
    const run = this.pluginsTail.then(
      () => this.handlePlugins(parsed.command),
      () => this.handlePlugins(parsed.command),
    );
    this.pluginsTail = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      reply(await run);
    } catch (error) {
      reply(pluginError(error));
    }
  }

  private async handlePlugins(command: PluginsCommand): Promise<PluginReply> {
    const host = this.pluginHost;
    if (!host) return pluginError("plugins are not available");

    if (command.action === "list") {
      return pluginReply({ plugins: this.pluginViews() });
    }

    if (command.action === "save") {
      const activeIds = new Set(this.pluginConfig.map((plugin) => plugin.id));
      const stagedIds = new Set(
        this.pluginSettings.staged.map((plugin) => plugin.id),
      );
      const activePatches = [];
      const stagedPatches = [];
      for (const patch of command.patches) {
        if (activeIds.has(patch.id)) activePatches.push(patch);
        else if (stagedIds.has(patch.id)) stagedPatches.push(patch);
        else return pluginError(`unknown plugin: ${patch.id}`);
      }
      if (stagedPatches.some((patch) => patch.enabled === true)) {
        return pluginError(
          "a staged plugin needs an adapter restart before it can be enabled",
        );
      }

      let staged = this.pluginSettings.staged;
      if (stagedPatches.length > 0) {
        const temporary = staged.map((entry): AdapterPlugin => ({
          id: entry.id,
          name: entry.name,
          enabled: false,
          builtin: false,
          timeoutMs: entry.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
          debug: false,
          ...(entry.help ? { help: entry.help } : {}),
          ...(entry.usage ? { usage: entry.usage } : {}),
          ...(entry.settings ? { settings: entry.settings } : {}),
          ...(entry.settingsSchema
            ? { settingsSchema: entry.settingsSchema }
            : {}),
          code: entry.code,
        }));
        const patched = applyPluginPatches(
          temporary,
          stagedPatches,
          BUILTIN_PLUGINS,
        );
        if (patched.problems.length > 0) {
          return pluginError(patched.problems.join("; "));
        }
        staged = patched.plugins.map((entry): ImportedPlugin => ({
          id: entry.id,
          name: entry.name,
          timeoutMs: entry.timeoutMs,
          ...(entry.help ? { help: entry.help } : {}),
          ...(entry.usage ? { usage: entry.usage } : {}),
          ...(entry.settings ? { settings: entry.settings } : {}),
          ...(entry.settingsSchema
            ? { settingsSchema: entry.settingsSchema }
            : {}),
          code: entry.code ?? "",
        }));
      }

      let active = this.pluginConfig;
      if (activePatches.length > 0) {
        const previous = this.pluginConfig;
        const patched = applyPluginPatches(
          active,
          activePatches,
          BUILTIN_PLUGINS,
        );
        if (patched.problems.length > 0) {
          return pluginError(patched.problems.join("; "));
        }
        active = patched.plugins;
        for (const patch of activePatches) {
          const entry = active.find((plugin) => plugin.id === patch.id);
          const before = previous.find((plugin) => plugin.id === patch.id);
          if (!entry) continue;
          if (patch.enabled !== undefined) await host.setEnabled(entry);
          if (
            patch.settings !== undefined &&
            pluginSettingsChanged(before?.settings, entry.settings)
          ) {
            await host.updateSettings(entry.id, entry.settings ?? {});
          }
          if (patch.timeoutMs !== undefined || patch.debug !== undefined) {
            host.updateMeta(entry.id, {
              timeoutMs: entry.timeoutMs,
              debug: entry.debug,
            });
          }
        }
      }
      this.pluginConfig = active;
      this.pluginSettings = {
        ...pluginSettingsDoc(active),
        staged,
        removals: this.pluginSettings.removals,
      };
      await this.savePluginSettings();
      const views = this.pluginViews();
      return pluginReply({
        plugins: views,
        restartRequired: views
          .filter((view) => view.restartRequired)
          .map((view) => view.id),
      });
    }

    if (command.action === "import") {
      const parsed = parsePluginFile({
        format: "ihome-plugin",
        version: 1,
        plugin: command.plugin,
      });
      if ("problem" in parsed) return pluginError(parsed.problem);
      this.pluginSettings = importStaged(this.pluginSettings, parsed.plugin);
      await this.savePluginSettings();
      return pluginReply({
        plugins: this.pluginViews(),
        restartRequired: [parsed.plugin.id],
      });
    }

    if (command.action === "export") {
      const staged = this.pluginSettings.staged.find(
        (entry) => entry.id === command.id,
      );
      if (staged) return pluginReply(pluginFile(staged));
      const plugin = this.pluginConfig.find((entry) => entry.id === command.id);
      if (!plugin) return pluginError(`unknown plugin: ${command.id}`);
      if (plugin.builtin) {
        return pluginError(
          `plugin ${command.id} is built-in and has no portable code`,
        );
      }
      return pluginReply(
        pluginFile({
          id: plugin.id,
          name: plugin.name,
          timeoutMs: plugin.timeoutMs,
          ...(plugin.help ? { help: plugin.help } : {}),
          ...(plugin.usage ? { usage: plugin.usage } : {}),
          ...(plugin.settings ? { settings: plugin.settings } : {}),
          ...(plugin.settingsSchema
            ? { settingsSchema: plugin.settingsSchema }
            : {}),
          code: plugin.code ?? "",
        }),
      );
    }

    const stagedPlugin = this.pluginSettings.staged.find(
      (entry) => entry.id === command.id,
    );
    if (stagedPlugin) {
      this.pluginSettings = removeStaged(this.pluginSettings, command.id);
      await this.savePluginSettings();
      return pluginReply({ plugins: this.pluginViews() });
    }
    const old = this.pluginConfig.find((entry) => entry.id === command.id);
    if (!old) return pluginError(`unknown plugin: ${command.id}`);
    if (old.builtin) {
      return pluginError(
        `plugin ${command.id} is built-in and cannot be deleted`,
      );
    }
    this.pluginSettings = stageRemoval(this.pluginSettings, command.id);
    if (this.pluginSettings.settings[command.id]) {
      this.pluginSettings.settings[command.id] = {
        ...this.pluginSettings.settings[command.id],
        enabled: false,
      };
    }
    this.pluginConfig = this.pluginConfig.map((entry) =>
      entry.id === command.id ? { ...entry, enabled: false } : entry,
    );
    await this.savePluginSettings();
    if (old.enabled) await host.setEnabled({ ...old, enabled: false });
    return pluginReply({ plugins: this.pluginViews() });
  }

  private async onPhoneMessage(obj: ioBroker.Message): Promise<void> {
    if (obj.command !== "phone") return;
    const reply = (result: unknown): void => {
      if (obj.callback)
        this.sendTo(obj.from, obj.command, result, obj.callback);
    };
    try {
      if (!isRecord(obj.message)) {
        reply({ ok: false, error: "invalid payload" });
        return;
      }
      const action = obj.message.action;
      if (action === "home") {
        const home = validHome(obj.message.home);
        if (!home) {
          reply({ ok: false, error: "invalid home" });
          return;
        }
        await this.setObjectNotExistsAsync("phone.home", {
          type: "state",
          common: {
            name: "Phone home point",
            type: "string",
            role: "text.json",
            read: true,
            write: false,
          },
          native: {},
        });
        await this.setStateAsync("phone.home", {
          val: JSON.stringify(home),
          ack: true,
        });
        reply({ ok: true });
        return;
      }
      const deviceId = validDeviceId(obj.message.deviceId);
      if (!deviceId) {
        reply({ ok: false, error: "invalid device id" });
        return;
      }
      if (action === "register") {
        const name = validPhoneName(obj.message.name) ?? deviceId;
        await this.ensurePhoneStates(deviceId, name);
        await this.writePhoneUpdate(deviceId, {
          name,
          enabled:
            typeof obj.message.enabled === "boolean"
              ? obj.message.enabled
              : true,
        });
        reply({ ok: true, deviceId });
      } else if (action === "update") {
        if (!isRecord(obj.message.data)) {
          reply({ ok: false, error: "invalid update" });
          return;
        }
        await this.ensurePhoneStates(deviceId, deviceId);
        await this.writePhoneUpdate(deviceId, obj.message.data);
        reply({ ok: true, deviceId });
      } else if (action === "remove") {
        await this.removePhoneDevice(deviceId);
        reply({ ok: true });
      } else {
        reply({ ok: false, error: "unknown action" });
      }
    } catch (error) {
      this.log.warn(`phone message: ${String(error)}`);
      reply({ ok: false, error: String(error) });
    }
  }

  private async onPushMessage(obj: ioBroker.Message): Promise<void> {
    const reply = (result: unknown): void => {
      if (obj.callback)
        this.sendTo(obj.from, obj.command, result, obj.callback);
    };
    try {
      if (!isRecord(obj.message)) {
        reply({ ok: false, error: "invalid payload" });
        return;
      }
      const deviceId = validDeviceId(obj.message.deviceId);
      if (!deviceId) {
        reply({ ok: false, error: "invalid device id" });
        return;
      }
      if (obj.message.action === "subscribe") {
        const subscription = validPushSubscription({
          ...(isRecord(obj.message.subscription)
            ? obj.message.subscription
            : {}),
          deviceId,
          name: obj.message.name,
          ts: Date.now(),
        });
        if (!subscription) {
          reply({ ok: false, error: "invalid subscription" });
          return;
        }
        this.pushSubscriptions = upsertPushSubscription(
          this.pushSubscriptions,
          subscription,
        );
        await this.writePushSubscriptions();
        reply({ ok: true, deviceId });
      } else if (obj.message.action === "unsubscribe") {
        this.pushSubscriptions = removePushSubscription(
          this.pushSubscriptions,
          deviceId,
        );
        await this.writePushSubscriptions();
        reply({ ok: true });
      } else {
        reply({ ok: false, error: "unknown action" });
      }
    } catch (error) {
      this.log.warn(`push message: ${String(error)}`);
      reply({ ok: false, error: String(error) });
    }
  }

  private async onNotifyMessage(obj: ioBroker.Message): Promise<void> {
    const reply = (result: unknown): void => {
      if (obj.callback)
        this.sendTo(obj.from, obj.command, result, obj.callback);
    };
    try {
      if (!isRecord(obj.message)) {
        reply({ ok: false, error: "invalid payload" });
        return;
      }
      const payload = validPushPayload(obj.message);
      if (!payload) {
        reply({ ok: false, error: "invalid payload" });
        return;
      }
      let deviceId: string | undefined;
      if (obj.message.deviceId !== undefined) {
        const valid = validDeviceId(obj.message.deviceId);
        if (!valid) {
          reply({ ok: false, error: "invalid device id" });
          return;
        }
        deviceId = valid;
      }
      const result = await this.sendPush(payload, deviceId);
      if (
        typeof obj.message.logicId === "string" &&
        obj.message.logicId.trim()
      ) {
        this.pushLogicLog(
          payload.level,
          obj.message.logicId.trim(),
          payload.body || payload.title,
        );
      }
      reply({ ok: true, ...result });
    } catch (error) {
      this.log.warn(`notify message: ${String(error)}`);
      reply({ ok: false, error: String(error) });
    }
  }

  private async loadPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    const state = await this.getStateAsync("info.pushSubscriptions");
    if (!state || typeof state.val !== "string") return [];
    try {
      const parsed = JSON.parse(state.val);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(validPushSubscription)
        .filter((entry): entry is PushSubscriptionRecord => entry !== null);
    } catch {
      return [];
    }
  }

  private async writePushSubscriptions(): Promise<void> {
    await this.setStateAsync("info.pushSubscriptions", {
      val: JSON.stringify(this.pushSubscriptions),
      ack: true,
    });
  }

  private async sendPush(
    payload: PushPayload,
    deviceId?: string,
  ): Promise<{ sent: number; removed: number }> {
    const safe = validPushPayload(payload);
    if (!safe) {
      this.log.warn("push payload rejected: title or body out of range");
      return { sent: 0, removed: 0 };
    }
    const targets = deviceId
      ? this.pushSubscriptions.filter((entry) => entry.deviceId === deviceId)
      : this.pushSubscriptions;
    if (!this.pushPublicKey || !this.pushPrivateKey || targets.length === 0) {
      return { sent: 0, removed: 0 };
    }
    const result = await sendPushes(targets, safe, (entry) =>
      webpush.sendNotification(
        { endpoint: entry.endpoint, keys: entry.keys },
        JSON.stringify(safe),
      ),
    );
    for (const error of result.errors) {
      this.log.warn(
        `push to ${error.deviceId} failed (${error.statusCode || "network"}): ${error.error}`,
      );
    }
    const kept = new Set(result.subscriptions.map((entry) => entry.deviceId));
    const gone = new Set(
      targets
        .filter((entry) => !kept.has(entry.deviceId))
        .map((entry) => entry.deviceId),
    );
    if (gone.size) {
      this.pushSubscriptions = this.pushSubscriptions.filter(
        (entry) => !gone.has(entry.deviceId),
      );
      await this.writePushSubscriptions();
    }
    return { sent: result.sent, removed: result.removed };
  }

  private async onReady(): Promise<void> {
    if (this.requireLog) {
      try {
        await this.requireLog(true);
      } catch (error) {
        this.log.warn(`log feed not available: ${String(error)}`);
      }
    }
    await this.setObjectNotExistsAsync("info.log", {
      type: "state",
      common: {
        name: "iHome log feed",
        type: "string",
        role: "text.json",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.setObjectNotExistsAsync("info.logic", {
      type: "state",
      common: {
        name: "iHome logic readout",
        type: "string",
        role: "text.json",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.setObjectNotExistsAsync("phone.home", {
      type: "state",
      common: {
        name: "Phone home point",
        type: "string",
        role: "text.json",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.setObjectNotExistsAsync("info.messages", {
      type: "state",
      common: {
        name: "iHome logic messages",
        type: "string",
        role: "text.json",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.setObjectNotExistsAsync("info.pushPublicKey", {
      type: "state",
      common: {
        name: "Web Push public key",
        type: "string",
        role: "text",
        read: true,
        write: false,
      },
      native: {},
    });
    const config = this.config as {
      vapidPublicKey?: unknown;
      vapidPrivateKey?: unknown;
    };
    const keys = ensureVapidKeys(
      config.vapidPublicKey,
      config.vapidPrivateKey,
      () => webpush.generateVAPIDKeys(),
    );
    let pushConfigured = false;
    if (keys) {
      this.pushPublicKey = keys.publicKey;
      this.pushPrivateKey = keys.privateKey;
      if (keys.generated) {
        try {
          await this.updateConfig({
            vapidPublicKey: keys.publicKey,
            vapidPrivateKey: keys.privateKey,
          });
          this.log.info(
            "Web Push keys generated and stored — no manual setup needed",
          );
        } catch (error) {
          this.log.warn(
            `cannot store generated Web Push keys: ${String(error)}`,
          );
        }
      }
      try {
        webpush.setVapidDetails(
          "mailto:ihome@localhost",
          keys.publicKey,
          keys.privateKey,
        );
        pushConfigured = true;
      } catch (error) {
        this.log.warn(`Web Push disabled: ${String(error)}`);
        this.pushPublicKey = "";
        this.pushPrivateKey = "";
      }
    }
    await this.setStateAsync("info.pushPublicKey", {
      val: pushConfigured ? this.pushPublicKey : "",
      ack: true,
    });
    if (!pushConfigured) {
      this.log.warn("Web Push disabled: could not create or read the keys");
    }
    await this.setObjectNotExistsAsync("info.pushSubscriptions", {
      type: "state",
      common: {
        name: "Web Push subscriptions",
        type: "string",
        role: "text.json",
        read: true,
        write: false,
      },
      native: {},
    });
    this.pushSubscriptions = await this.loadPushSubscriptions();
    await this.setObjectNotExistsAsync("info.logClear", {
      type: "state",
      common: {
        name: "Clear the iHome log",
        type: "boolean",
        role: "button",
        read: true,
        write: true,
      },
      native: {},
    });
    this.subscribeStates("info.logClear");
    await this.setObjectNotExistsAsync("phone.pushMessage", {
      type: "state",
      common: {
        name: "Send a push message (first line = title)",
        type: "string",
        role: "text",
        read: true,
        write: true,
      },
      native: {},
    });
    this.subscribeStates("phone.pushMessage");
    await this.setObjectNotExistsAsync("phone.uiMessage", {
      type: "state",
      common: {
        name: "Show a UI message (Alarm/Warning/Info prefix)",
        type: "string",
        role: "text",
        read: true,
        write: true,
      },
      native: {},
    });
    this.subscribeStates("phone.uiMessage");
    this.log.debug(
      `Ready: ensuring ${DOCS.length} documents under ${this.namespace}.${CONFIG_FOLDER}`,
    );
    for (const name of DOCS) {
      const target = `${CONFIG_FOLDER}.${name}`;
      await this.setObjectNotExistsAsync(target, {
        type: "state",
        common: {
          name,
          // Documents are JSON text: string type + the text.json role.
          type: "string",
          role: "text.json",
          read: true,
          write: true,
        },
        native: {},
      });

      // States created before `text.json` existed still carry type/role "json".
      const currentObject = await this.getObjectAsync(target);
      if (
        currentObject &&
        (currentObject.common?.type !== "string" ||
          currentObject.common?.role !== "text.json")
      ) {
        await this.extendObjectAsync(target, {
          common: { type: "string", role: "text.json" },
        });
      }

      const current = await this.getStateAsync(target);
      this.log.debug(
        `Document ${target}: ${
          current?.val == null
            ? "empty"
            : isPlaceholder(current.val)
              ? "placeholder"
              : "present"
        }`,
      );
      if (current?.val == null || isPlaceholder(current.val)) {
        // oldest first: the test namespace, then the plain state in the root
        const fromLegacy = await this.getForeignStateAsync(
          LEGACY_PREFIX + name,
        );
        const fromRoot = await this.getStateAsync(name);
        const source = fromLegacy?.val != null ? fromLegacy : fromRoot;
        if (source?.val != null) {
          this.log.debug(
            `Document ${target}: copying from ${
              fromLegacy?.val != null
                ? "the legacy namespace"
                : "the root state"
            }`,
          );
          await this.setStateAsync(target, { val: source.val, ack: true });
          this.log.info(`Copied ${name} to ${this.namespace}.${target}`);
        }
      }

      // the documents belong to config.* — drop the old state in the root
      if (await this.getObjectAsync(name)) {
        if (
          (await this.getStateAsync(target))?.val == null &&
          (await this.getStateAsync(name))?.val != null
        ) {
          this.log.warn(
            `Keeping ${this.namespace}.${name}: ${target} is empty`,
          );
        } else {
          await this.delObjectAsync(name);
          this.log.debug(
            `Document ${target}: removing the old root state ${name}`,
          );
          this.log.info(`Removed the old root state ${this.namespace}.${name}`);
        }
      }
    }

    // The constants of the loaded config live in memory (loadVariables); the
    // list itself may be edited by the SPA later, so keep the copy current.
    await this.loadVariables();
    this.subscribeStates(`${CONFIG_FOLDER}.variableList`);
    this.subscribeStates(`${CONFIG_FOLDER}.logicList`);
    this.subscribeStates(`${CONFIG_FOLDER}.pluginSettings`);
    this.on("stateChange", (id, state) => {
      if (!state) return;
      // Compare against the cached value before overwriting it: ack-only
      // updates are not a change (D6).
      const previous = this.logicValues.get(id)?.val;
      const changed = !Object.is(previous, state.val);
      this.logicValues.set(id, {
        id,
        val: state.val,
        ack: state.ack,
        from: state.from,
        ts: state.ts,
        changed,
      });
      this.engine?.onStateChange({
        id,
        val: state.val,
        ack: state.ack,
        from: state.from,
        ts: state.ts,
        changed,
      });
      if (id === `${this.namespace}.info.logClear`) {
        if (state.val === true) {
          this.logs.clear();
          this.scheduleLogState();
          void this.setStateAsync("info.logClear", {
            val: false,
            ack: true,
          }).catch(() => {});
        }
      } else if (id === `${this.namespace}.phone.pushMessage`) {
        if (state.ack === false) {
          const payload = pushStatePayload(state.val);
          if (payload) {
            void this.sendPush(payload)
              .then((result) => {
                if (result.sent === 0) {
                  this.log.warn(
                    "push message: no subscribed phone received it",
                  );
                }
              })
              .catch((error) =>
                this.log.warn(`push message failed: ${String(error)}`),
              );
          }
          // A command state: clear it so the same text can be sent again.
          void this.setStateAsync("phone.pushMessage", {
            val: "",
            ack: true,
          }).catch(() => {});
        }
      } else if (id === `${this.namespace}.phone.uiMessage`) {
        if (state.ack === false) {
          const message = uiMessage(state.val);
          if (message) {
            this.pushMessage(
              message.level,
              "ui",
              message.text,
              message.timeout,
            );
          }
          // A command state: clear it so the same text can be shown again.
          void this.setStateAsync("phone.uiMessage", {
            val: "",
            ack: true,
          }).catch(() => {});
        }
      } else if (id === this.pluginSettingsStateId()) {
        const text = typeof state.val === "string" ? state.val : "";
        if (text === this.pluginSettingsText) return;
        const doc = normalizeSettingsDoc(text);
        if (doc) {
          void this.applyPluginSettings(doc, text).catch((error) =>
            this.log.warn(`plugin settings: ${String(error)}`),
          );
        }
      } else if (id === `${this.namespace}.${CONFIG_FOLDER}.variableList`) {
        this.log.debug(`${CONFIG_FOLDER}.variableList changed; reloading`);
        // A variable edit can change what a logic ref resolves to.
        void this.loadVariables().then(() => this.loadLogics());
      } else if (id === `${this.namespace}.${CONFIG_FOLDER}.logicList`) {
        this.log.debug(
          `${CONFIG_FOLDER}.logicList changed; reloading the engine`,
        );
        void this.loadLogics();
      }
    });
    const networkDevices = validNetworkDevices(
      (this.config as { networkDevices?: unknown }).networkDevices,
    );

    const rawPlugins = (this.config as { plugins?: unknown }).plugins;
    const nativePlugins = seedBuiltinPlugins(rawPlugins, undefined, (message) =>
      this.log.warn(message),
    );
    const persistedPlugins = pluginConfigWithBuiltins(rawPlugins);
    if (JSON.stringify(persistedPlugins) !== JSON.stringify(rawPlugins)) {
      try {
        await this.updateConfig({ plugins: persistedPlugins });
      } catch (error) {
        this.log.warn(`cannot store the plugin list: ${String(error)}`);
      }
    }

    // Page-managed settings live outside native config, so availability,
    // settings and debug changes do not restart the adapter. Imports and
    // removals are applied here, at the next start.
    let native = nativePlugins.map((plugin) => ({ ...plugin }));
    let doc = (await this.readPluginSettings()) ?? pluginSettingsDoc(native);
    let nativeDirty = false;
    for (const imported of doc.staged) {
      if (BUILTIN_PLUGINS.some((builtin) => builtin.id === imported.id)) {
        this.log.warn(`staged plugin ${imported.id}: built-in id is reserved`);
        continue;
      }
      const entry: AdapterPlugin = {
        id: imported.id,
        name: imported.name,
        enabled: false,
        builtin: false,
        timeoutMs: imported.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: false,
        ...(imported.help ? { help: imported.help } : {}),
        ...(imported.usage ? { usage: imported.usage } : {}),
        ...(imported.settings ? { settings: imported.settings } : {}),
        ...(imported.settingsSchema
          ? { settingsSchema: imported.settingsSchema }
          : {}),
        code: imported.code,
      };
      const existing = native.find((plugin) => plugin.id === entry.id);
      if (existing) Object.assign(existing, entry);
      else native.push(entry);
      doc.settings[entry.id] = {
        enabled: false,
        timeoutMs: entry.timeoutMs,
        debug: false,
        ...(entry.help ? { help: entry.help } : {}),
        ...(entry.usage ? { usage: entry.usage } : {}),
        ...(entry.settings ? { settings: entry.settings } : {}),
        ...(entry.settingsSchema
          ? { settingsSchema: entry.settingsSchema }
          : {}),
      };
      nativeDirty = true;
      this.log.info(`staged plugin ${entry.id}: installed disabled`);
    }
    for (const id of doc.removals) {
      const plugin = native.find((entry) => entry.id === id);
      if (!plugin || plugin.builtin) continue;
      native = native.filter((entry) => entry.id !== id);
      delete doc.settings[id];
      nativeDirty = true;
      this.log.info(`staged removal ${id}: plugin removed`);
    }
    doc = { ...doc, staged: [], removals: [] };
    if (nativeDirty) {
      try {
        await this.updateConfig({ plugins: native });
      } catch (error) {
        this.log.warn(`cannot store the plugin list: ${String(error)}`);
      }
    }
    this.pluginConfig = mergePluginSettings(native, doc);
    this.pluginSettings = pluginSettingsDoc(this.pluginConfig);
    await this.savePluginSettings();

    this.pluginHost = createPluginHost(
      this.pluginConfig,
      (plugin, runtime) =>
        createPluginApi(plugin.id, {
          namespace: this.namespace,
          config: this.config as Record<string, unknown>,
          networkDevices,
          getState: (id) => this.getStateAsync(id),
          setState: (id, value, ack) =>
            this.setStateAsync(id, {
              val: value as ioBroker.StateValue,
              ack,
            }),
          getForeignState: (id) => this.getForeignStateAsync(id),
          setForeignState: (id, value, ack) =>
            this.setForeignStateAsync(id, {
              val: value as ioBroker.StateValue,
              ack,
            }),
          getObject: async (id) =>
            (await this.getObjectAsync(id)) as unknown as Record<
              string,
              unknown
            > | null,
          getForeignObject: async (id) =>
            (await this.getForeignObjectAsync(id)) as unknown as Record<
              string,
              unknown
            > | null,
          sendTo: (instance, command, payload) =>
            this.sendToAsync(instance, command, payload),
          settings: () => runtime.settings,
          debug: () => runtime.debug,
          log: {
            debug: (message) => this.log.debug(message),
            info: (message) => this.log.info(message),
            warn: (message) => this.log.warn(message),
            error: (message) => this.log.error(message),
          },
        }),
      createNetworkPlugins(),
      (level, message) => this.log[level](message),
    );
    await this.pluginHost.start();

    await this.loadLogics();

    if (networkDevices.length > 0) {
      this.networkPresence = new NetworkPresenceService(this, networkDevices);
      await this.networkPresence.start();
    }

    this.log.info(`iHome ${this.version ?? ""} started (${this.namespace})`);
    this.heartbeat = setInterval(() => {
      const minutes = Math.round((Date.now() - this.startedAt) / 60_000);
      this.log.info(`iHome alive (${minutes} min, ${this.namespace})`);
    }, HEARTBEAT_MS);
  }

  private onUnload(callback: () => void): void {
    void this.shutdown(callback);
  }

  private async shutdown(callback: () => void): Promise<void> {
    this.log.debug("Unload: stopping the heartbeat and the logic engine");
    const pluginHost = this.pluginHost;
    this.pluginHost = undefined;
    if (pluginHost) {
      try {
        await pluginHost.stop();
      } catch (error) {
        this.log.warn(`plugins did not stop cleanly: ${String(error)}`);
      }
    }
    this.networkPresence?.stop();
    this.networkPresence = undefined;
    if (this.logStateTimer) {
      clearTimeout(this.logStateTimer);
      this.logStateTimer = undefined;
    }
    if (this.logicStateTimer) {
      clearTimeout(this.logicStateTimer);
      this.logicStateTimer = undefined;
    }
    if (this.requireLog) {
      try {
        void this.requireLog(false);
      } catch {
        // unload must never throw on the log feed
      }
    }
    if (this.engine) {
      this.engine.stop();
      this.engine = undefined;
    }
    const ids = this.logicIds;
    this.logicIds = [];
    const own = ids.filter((id) => id.startsWith(`${this.namespace}.`));
    const foreign = ids.filter((id) => !id.startsWith(`${this.namespace}.`));
    if (own.length) void this.unsubscribeStatesAsync(own).catch(() => {});
    if (foreign.length)
      void this.unsubscribeForeignStatesAsync(foreign).catch(() => {});
    this.logicValues.clear();
    this.stateTypes.clear();
    this.stateWritable.clear();
    this.warnedWrites.clear();
    this.logicInfo.clear();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.log.info(`iHome shutting down (${this.namespace})`);
    callback();
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options?: Partial<utils.AdapterOptions>) =>
    new IHome(options);
} else {
  // Otherwise start the instance directly
  new IHome();
}
