import * as utils from "@iobroker/adapter-core";
import { createEngine, type Engine, type StateChange } from "./logic/engine";
import { parseLogicDocument } from "./logic/validate";
import type { LogicDocument } from "./logic/types";

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
  /** Guards overlapping reloads: only the newest may swap the engine. */
  private logicLoad = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly startedAt = Date.now();

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "ihome" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
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

    let next: Engine;
    try {
      next = createEngine(
        doc,
        {
          read: (id) => this.logicValues.get(id)?.val,
          write: (id, value, ack) => this.writeLogicState(id, value, ack),
          log: (level, logicId, message) => {
            const line = `[logic ${logicId}] ${message}`;
            if (level === "warn") this.log.warn(line);
            else this.log.info(line);
          },
          now: () => Date.now(),
          setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
          clearTimeout: (handle) =>
            clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
          resolveVariable: (name) => {
            const constant = this.variables.constants[name];
            if (constant) return { kind: "const", value: constant.val };
            const variable = this.variables.states[name];
            if (variable) return { kind: "state", stateId: variable.stateId };
            return undefined;
          },
        },
        { ownFrom: `system.adapter.${this.namespace}` },
      );
    } catch (error) {
      this.log.warn(`logic engine not rebuilt: ${error}`);
      return;
    }

    const ids = next.subscriptions();
    const isOwn = (id: string) => id.startsWith(`${this.namespace}.`);
    const before = new Set(this.logicIds);
    const added = ids.filter((id) => !before.has(id));
    const removed = this.logicIds.filter((id) => !ids.includes(id));
    try {
      // Subscribe before warming: a change between the two is then delivered
      // instead of being lost and leaving the engine on a stale value.
      const own = added.filter(isOwn);
      const foreign = added.filter((id) => !isOwn(id));
      if (own.length) await this.subscribeStatesAsync(own);
      if (foreign.length) await this.subscribeForeignStatesAsync(foreign);
      const ownGone = removed.filter(isOwn);
      const foreignGone = removed.filter((id) => !isOwn(id));
      if (ownGone.length) await this.unsubscribeStatesAsync(ownGone);
      if (foreignGone.length)
        await this.unsubscribeForeignStatesAsync(foreignGone);
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
      next.start();
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
    this.log.info(
      `Logic engine: ${doc.logics.length} logic(s), ${ids.length} subscribed state(s)`,
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
          const type = (object?.common as { type?: string } | undefined)?.type;
          if (type) this.stateTypes.set(id, type);
        } catch {
          // a state without an object keeps its value type
        }
      }),
    );
  }

  private writeLogicState(id: string, value: unknown, ack: boolean): void {
    const state = {
      val: coerceStateValue(value, this.stateTypes.get(id)) as never,
      ack,
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
      if (id === `${this.namespace}.${CONFIG_FOLDER}.variableList`) {
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
