import * as utils from "@iobroker/adapter-core";

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
] as const;

// Data of the pre-adapter test namespace; copied once, then left untouched.
const LEGACY_PREFIX = "0_userdata.0.Test.AiHome.";

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
    const st = await this.getStateAsync(`${CONFIG_FOLDER}.variableList`);
    let doc: unknown = st?.val;
    if (typeof doc === "string") {
      try {
        doc = JSON.parse(doc);
      } catch {
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

  private async onReady(): Promise<void> {
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
      if (current?.val == null || isPlaceholder(current.val)) {
        // oldest first: the test namespace, then the plain state in the root
        const fromLegacy = await this.getForeignStateAsync(
          LEGACY_PREFIX + name,
        );
        const fromRoot = await this.getStateAsync(name);
        const source = fromLegacy?.val != null ? fromLegacy : fromRoot;
        if (source?.val != null) {
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
          this.log.info(`Removed the old root state ${this.namespace}.${name}`);
        }
      }
    }

    // The constants of the loaded config live in memory (loadVariables); the
    // list itself may be edited by the SPA later, so keep the copy current.
    await this.loadVariables();
    this.subscribeStates(`${CONFIG_FOLDER}.variableList`);
    this.on("stateChange", (id, state) => {
      if (id === `${this.namespace}.${CONFIG_FOLDER}.variableList` && state) {
        void this.loadVariables();
      }
    });
  }

  private onUnload(callback: () => void): void {
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
