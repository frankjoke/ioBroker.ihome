import * as utils from "@iobroker/adapter-core";
import * as SunCalc from "suncalc";
import {
  createEngine,
  type Engine,
  type LogicReading,
  type StateChange,
} from "./logic/engine";
import { parseLogicDocument } from "./logic/validate";
import { subscriptionDiff } from "./logic/subscriptions";
import type { AstroEvent, LogicDef, LogicDocument } from "./logic/types";
import { createLogBuffer } from "./log-buffer";

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
] as const;

// Data of the pre-adapter test namespace; copied once, then left untouched.
const LEGACY_PREFIX = "0_userdata.0.Test.AiHome.";

/** A machine's states as `{ "0": "Off", "1": "On" }`, for a number output. */
function numberStatesOf(def: LogicDef): Record<string, string> | undefined {
  if (def.kind !== "machine") return undefined;
  const names = Object.keys(def.states ?? {});
  if (names.length === 0) return undefined;
  return Object.fromEntries(names.map((name, index) => [String(index), name]));
}

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
  /** The live readout per logic, published as `info.logic`. */
  private readonly logicInfo = new Map<string, LogicReading>();
  private logicStateTimer?: ReturnType<typeof setTimeout>;

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "ihome" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("log", (entry: ioBroker.LogMessage) => this.onLog(entry));
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
   * The logic states the adapter owns: `<namespace>.Logic.<logic id>`. Created
   * on demand and kept in step with the document; never deleted (a deleted logic
   * leaves its state, like a variable does). A logic output is a command, so the
   * role is level.switch (binary) or level.state — never `value`, which the
   * ecosystem reserves for read-only sensor readings.
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
        const output = def.output as Extract<
          NonNullable<LogicDef["output"]>,
          { scope: "logic" }
        >;
        const id = `Logic.${def.id}`;
        const states =
          output.type === "number" ? numberStatesOf(def) : undefined;
        const common = {
          name: def.name,
          type: output.type,
          role: output.type === "boolean" ? "level.switch" : "level.state",
          read: true,
          write: true,
          def:
            output.type === "boolean"
              ? false
              : output.type === "number"
                ? 0
                : "",
          unit: output.type === "number" ? (output.unit ?? "") : "",
          ...(states ? { states } : {}),
        };
        try {
          await this.setObjectNotExistsAsync(id, {
            type: "state",
            common,
            native: {},
          });
          // The document is the truth: keep the name, type and state labels in step.
          await this.extendObjectAsync(id, { common });
        } catch (error) {
          this.log.warn(
            `logic: cannot ensure ${this.namespace}.${id}: ${error}`,
          );
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
    let doc: LogicDocument | null = { version: 1, logics: [] };
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

    await this.ensureAstroConfig();
    await this.ensureLogicStates(doc);

    let next: Engine;
    try {
      next = createEngine(
        doc,
        {
          read: (id) => this.logicValues.get(id)?.val,
          write: (id, value, ack) => this.writeLogicState(id, value, ack),
          log: (level, logicId, message) => {
            const line = `[logic ${logicId}] ${message}`;
            this.logs.push({
              ts: Date.now(),
              from: this.namespace,
              severity: level,
              message: line,
            });
            this.scheduleLogState();
            if (level === "warn") this.log.warn(line);
            else this.log.info(line);
          },
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
        role: "json",
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
        role: "json",
        read: true,
        write: false,
      },
      native: {},
    });
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
    this.log.debug(
      `Ready: ensuring ${DOCS.length} documents under ${this.namespace}.${CONFIG_FOLDER}`,
    );
    for (const name of DOCS) {
      const target = `${CONFIG_FOLDER}.${name}`;
      await this.setObjectNotExistsAsync(target, {
        type: "state",
        common: {
          name,
          // The broker accepts "json"; ioBroker's CommonType omits it.
          type: "json" as never,
          role: "json",
          read: true,
          write: true,
        },
        native: {},
      });

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
    this.on("stateChange", (id, state) => {
      if (!state) return;
      this.logicValues.set(id, {
        id,
        val: state.val,
        ack: state.ack,
        from: state.from,
        ts: state.ts,
      });
      this.engine?.onStateChange({
        id,
        val: state.val,
        ack: state.ack,
        from: state.from,
        ts: state.ts,
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
    await this.loadLogics();

    this.log.info(`iHome ${this.version ?? ""} started (${this.namespace})`);
    this.heartbeat = setInterval(() => {
      const minutes = Math.round((Date.now() - this.startedAt) / 60_000);
      this.log.info(`iHome alive (${minutes} min, ${this.namespace})`);
    }, HEARTBEAT_MS);
  }

  private onUnload(callback: () => void): void {
    this.log.debug("Unload: stopping the heartbeat and the logic engine");
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
