import type { ImportedPlugin } from "./plugin-file";
import type { CaptureRequest, CollectionConflict } from "./plugin-collection";
import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_HELP,
  MAX_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_USAGE,
  MIN_PLUGIN_TIMEOUT_MS,
  contributionSummary,
  pluginSettings,
  settingsProblem,
  validPluginId,
  type AdapterPlugin,
  type ContributionSummary,
  type PluginContributions,
  type PluginSettingDef,
  type SettingsTabDef,
} from "./plugin-ops";

export interface PluginPatch {
  id: string;
  name?: string;
  enabled?: boolean;
  timeoutMs?: number;
  debug?: boolean;
  secured?: boolean;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
}

export type PluginViewStatus =
  "running" | "disabled" | "failed" | "restart-required";

export interface PluginView {
  id: string;
  name: string;
  /** Plugin API the code needs; absent means 1. */
  api?: number;
  /** Display version from the manifest. */
  version?: string;
  enabled: boolean;
  builtin: boolean;
  timeoutMs: number;
  debug: boolean;
  /** Hidden from the Plugins list outside the local network. */
  secured?: boolean;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
  settingsSchema?: PluginSettingDef[];
  settingsTabs?: SettingsTabDef[];
  /** Counts of the templates and snippets the plugin offers. */
  contributions?: ContributionSummary;
  /** Counts of the items the plugin owns; bodies stay in the manifest. */
  collection?: { states: number; logics: number; tiles: number; uses: number };
  /** Non-fatal manifest notes, e.g. a retired bundle field. */
  warnings?: string[];
  status: PluginViewStatus;
  hotSettings: boolean;
  hasCode: boolean;
  codeLength: number;
  restartRequired: boolean;
  /** A staged import that is not active yet. */
  staged: boolean;
  /** A user plugin waiting to be removed at the next start. */
  removalPending: boolean;
  /** Why the plugin cannot be used (a broken file, a failed start). */
  problem?: string;
}

export type PluginsCommand =
  | { action: "list" }
  | { action: "contributions" }
  | { action: "save"; patches: PluginPatch[] }
  | { action: "import"; plugin: ImportedPlugin }
  | { action: "export"; id: string }
  | { action: "delete"; id: string }
  | { action: "reload"; id: string }
  | { action: "install"; id: string }
  | { action: "collection.capture"; request: CaptureRequest }
  | { action: "collection.apply"; id: string; overwrite?: boolean }
  | { action: "remove"; id: string; removeCollectionStates?: boolean };

/** The collection part of an install/apply reply. */
export interface CollectionReply {
  id: string;
  conflicts: CollectionConflict[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function clampTimeout(value: number): number {
  return Math.min(
    MAX_PLUGIN_TIMEOUT_MS,
    Math.max(MIN_PLUGIN_TIMEOUT_MS, Math.round(value)),
  );
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/**
 * Apply metadata patches. Code, schema and the plugin's built-in identity are
 * never changed here; the caller persists the returned list only when
 * `problems` is empty.
 */
export function applyPluginPatches(
  current: AdapterPlugin[],
  patches: PluginPatch[],
  builtins = BUILTIN_PLUGINS,
): { plugins: AdapterPlugin[]; problems: string[] } {
  const plugins = current.map((plugin) => ({ ...plugin }));
  const problems: string[] = [];

  for (const patch of patches) {
    const index = plugins.findIndex((plugin) => plugin.id === patch.id);
    if (index < 0) {
      problems.push(`unknown plugin: ${patch.id}`);
      continue;
    }
    const existing = plugins[index];
    if (
      existing.builtin &&
      !builtins.some((builtin) => builtin.id === existing.id)
    ) {
      problems.push(`unknown built-in plugin: ${patch.id}`);
      continue;
    }
    const next = { ...existing };
    let bad = false;
    const fail = (message: string) => {
      problems.push(message);
      bad = true;
    };

    if (patch.name !== undefined) {
      if (existing.builtin) fail(`built-in ${patch.id} cannot be renamed`);
      else {
        const name = text(patch.name, 64);
        if (!name) fail(`plugin ${patch.id} needs a name`);
        else next.name = name;
      }
    }
    for (const [key, max] of [
      ["help", MAX_PLUGIN_HELP],
      ["usage", MAX_PLUGIN_USAGE],
    ] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (existing.builtin) {
        fail(`built-in ${patch.id} help/usage comes from the adapter`);
        continue;
      }
      if (typeof value !== "string") {
        fail(`plugin ${patch.id} ${key} must be text`);
        continue;
      }
      if (value.length > max) {
        fail(`plugin ${patch.id} ${key} must be at most ${max} characters`);
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
      else delete next[key];
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") {
        fail(`plugin ${patch.id} enabled must be true or false`);
      } else next.enabled = patch.enabled;
    }
    if (patch.debug !== undefined) {
      if (typeof patch.debug !== "boolean") {
        fail(`plugin ${patch.id} debug must be true or false`);
      } else next.debug = patch.debug;
    }
    if (patch.secured !== undefined) {
      if (typeof patch.secured !== "boolean") {
        fail(`plugin ${patch.id} secured must be true or false`);
      } else next.secured = patch.secured;
    }
    if (patch.timeoutMs !== undefined) {
      if (
        typeof patch.timeoutMs !== "number" ||
        !Number.isFinite(patch.timeoutMs)
      ) {
        fail(`plugin ${patch.id} timeout must be a number`);
      } else next.timeoutMs = clampTimeout(patch.timeoutMs);
    }
    if (patch.settings !== undefined) {
      const settings = pluginSettings(patch.settings);
      if (!settings) {
        fail(`plugin ${patch.id} settings are too large or not JSON-safe`);
      } else {
        const settingsError = settingsProblem(
          existing.settingsSchema,
          settings,
        );
        if (settingsError) fail(`plugin ${patch.id}: ${settingsError}`);
        else next.settings = settings;
      }
    }
    if (!bad) plugins[index] = next;
  }

  return { plugins, problems };
}

/** Add or replace a user plugin as a disabled, restart-required stage. */
export function pluginView(
  plugin: AdapterPlugin,
  opts: {
    status: PluginViewStatus;
    hotSettings: boolean;
    restartRequired: boolean;
    staged?: boolean;
    removalPending?: boolean;
    /** Why the plugin cannot be used (a broken file, a failed start). */
    problem?: string;
  },
): PluginView {
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.api !== undefined ? { api: plugin.api } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    enabled: plugin.enabled,
    builtin: plugin.builtin === true,
    timeoutMs: plugin.timeoutMs,
    debug: plugin.debug,
    ...(plugin.secured ? { secured: true } : {}),
    ...(plugin.help ? { help: plugin.help } : {}),
    ...(plugin.usage ? { usage: plugin.usage } : {}),
    ...(plugin.settings ? { settings: { ...plugin.settings } } : {}),
    ...(plugin.settingsSchema ? { settingsSchema: plugin.settingsSchema } : {}),
    ...(plugin.settingsTabs ? { settingsTabs: plugin.settingsTabs } : {}),
    ...(plugin.contributions
      ? { contributions: contributionSummary(plugin.contributions) }
      : {}),
    ...(plugin.collection
      ? {
          collection: {
            states: plugin.collection.states.length,
            logics: plugin.collection.logics.length,
            tiles: plugin.contributions?.tiles?.length ?? 0,
            uses: plugin.collection.uses?.length ?? 0,
          },
        }
      : {}),
    ...(plugin.warnings ? { warnings: plugin.warnings } : {}),
    ...(opts.problem ? { problem: opts.problem } : {}),
    status: opts.status,
    hotSettings: opts.hotSettings,
    hasCode: !!plugin.code?.trim(),
    codeLength: plugin.code?.length ?? 0,
    restartRequired: opts.restartRequired,
    staged: opts.staged === true,
    removalPending: opts.removalPending === true,
  };
}

/** The full contribution bodies for the SPA; the plugin list keeps counts. */
export function contributionsReply(
  plugins: AdapterPlugin[],
  problems: Map<string, string>,
): {
  plugins: Array<{
    id: string;
    name: string;
    enabled: boolean;
    contributions: PluginContributions;
    problem?: string;
  }>;
} {
  return {
    plugins: plugins.map((plugin) => {
      const problem = problems.get(plugin.id);
      return {
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.enabled,
        contributions: plugin.contributions ?? {},
        ...(problem ? { problem } : {}),
      };
    }),
  };
}

function parsePatch(value: unknown): PluginPatch | null {
  if (!record(value)) return null;
  const id = value.id;
  if (!validPluginId(id)) return null;
  const name = value.name;
  if (name !== undefined && typeof name !== "string") return null;
  const enabled = value.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") return null;
  const timeoutMs = value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs))
  ) {
    return null;
  }
  const debug = value.debug;
  if (debug !== undefined && typeof debug !== "boolean") return null;
  const secured = value.secured;
  if (secured !== undefined && typeof secured !== "boolean") return null;
  const help = value.help;
  if (help !== undefined && typeof help !== "string") return null;
  const usage = value.usage;
  if (usage !== undefined && typeof usage !== "string") return null;
  const settings = value.settings;
  if (settings !== undefined && !record(settings)) return null;
  const patch: PluginPatch = { id };
  if (typeof name === "string") patch.name = name;
  if (typeof enabled === "boolean") patch.enabled = enabled;
  if (typeof timeoutMs === "number") patch.timeoutMs = timeoutMs;
  if (typeof debug === "boolean") patch.debug = debug;
  if (typeof secured === "boolean") patch.secured = secured;
  if (typeof help === "string") patch.help = help;
  if (typeof usage === "string") patch.usage = usage;
  if (record(settings)) patch.settings = settings;
  return patch;
}

export function parsePluginsCommand(
  value: unknown,
): { command: PluginsCommand } | { problem: string } {
  if (!record(value)) return { problem: "invalid plugins command" };
  const action = value.action;
  if (action === "list") return { command: { action: "list" } };
  if (action === "contributions") {
    return { command: { action: "contributions" } };
  }
  if (action === "save") {
    if (!Array.isArray(value.patches)) {
      return { problem: "save needs a patches array" };
    }
    const patches: PluginPatch[] = [];
    for (const entry of value.patches) {
      const patch = parsePatch(entry);
      if (!patch) return { problem: "invalid plugin patch" };
      patches.push(patch);
    }
    return { command: { action: "save", patches } };
  }
  if (action === "import") {
    if (!record(value.plugin)) {
      return { problem: "import needs a plugin object" };
    }
    return {
      command: {
        action: "import",
        plugin: value.plugin as unknown as ImportedPlugin,
      },
    };
  }
  if (
    action === "export" ||
    action === "delete" ||
    action === "reload" ||
    action === "install"
  ) {
    if (typeof value.id !== "string" || !value.id.trim()) {
      return { problem: `${action} needs a plugin id` };
    }
    return { command: { action, id: value.id.trim() } };
  }
  if (action === "remove") {
    if (typeof value.id !== "string" || !value.id.trim()) {
      return { problem: "remove needs a plugin id" };
    }
    if (
      value.removeCollectionStates !== undefined &&
      typeof value.removeCollectionStates !== "boolean"
    ) {
      return { problem: "removeCollectionStates must be true or false" };
    }
    return {
      command: {
        action: "remove",
        id: value.id.trim(),
        ...(value.removeCollectionStates === true
          ? { removeCollectionStates: true }
          : {}),
      },
    };
  }
  if (action === "collection.apply") {
    if (typeof value.id !== "string" || !value.id.trim()) {
      return { problem: "collection.apply needs a plugin id" };
    }
    if (value.overwrite !== undefined && typeof value.overwrite !== "boolean") {
      return { problem: "overwrite must be true or false" };
    }
    return {
      command: {
        action: "collection.apply",
        id: value.id.trim(),
        ...(value.overwrite === true ? { overwrite: true } : {}),
      },
    };
  }
  if (action === "collection.capture") {
    if (!record(value.request)) {
      return { problem: "collection.capture needs a request" };
    }
    const source = value.request;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!validPluginId(id)) {
      return { problem: "the collection plugin id is invalid" };
    }
    const name = text(source.name, 64);
    if (!name) return { problem: "the collection plugin needs a name" };
    const version = text(source.version, 32);
    if (!version) return { problem: "the collection plugin needs a version" };
    const strings = (list: unknown): string[] | undefined => {
      if (!Array.isArray(list)) return undefined;
      if (list.some((item) => typeof item !== "string" || !item.trim())) {
        return undefined;
      }
      return list.map((item) => (item as string).trim());
    };
    const logicIds = strings(source.logicIds);
    const stateIds = strings(source.stateIds);
    if (!logicIds || !stateIds) {
      return { problem: "logicIds and stateIds must be id arrays" };
    }
    if (!Array.isArray(source.tiles)) {
      return { problem: "tiles must be an array" };
    }
    return {
      command: {
        action: "collection.capture",
        request: {
          id,
          name,
          version,
          logicIds,
          stateIds,
          tiles: source.tiles,
        },
      },
    };
  }
  return { problem: "unknown plugins command" };
}
