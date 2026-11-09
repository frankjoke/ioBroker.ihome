import type { ImportedPlugin } from "./plugin-file";
import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_HELP,
  MAX_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_USAGE,
  MIN_PLUGIN_TIMEOUT_MS,
  pluginSettings,
  settingsProblem,
  validPluginId,
  type AdapterPlugin,
  type PluginBundle,
  type PluginSettingDef,
} from "./plugin-ops";

export interface PluginPatch {
  id: string;
  name?: string;
  enabled?: boolean;
  timeoutMs?: number;
  debug?: boolean;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
}

export type PluginViewStatus =
  "running" | "disabled" | "failed" | "restart-required";

export interface PluginView {
  id: string;
  name: string;
  enabled: boolean;
  builtin: boolean;
  timeoutMs: number;
  debug: boolean;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
  settingsSchema?: PluginSettingDef[];
  /** Declarative device the UI creates when the plugin is enabled. */
  bundle?: PluginBundle;
  status: PluginViewStatus;
  hotSettings: boolean;
  hasCode: boolean;
  codeLength: number;
  restartRequired: boolean;
  /** A staged import that is not active yet. */
  staged: boolean;
  /** A user plugin waiting to be removed at the next start. */
  removalPending: boolean;
}

export type PluginsCommand =
  | { action: "list" }
  | { action: "save"; patches: PluginPatch[] }
  | { action: "import"; plugin: ImportedPlugin }
  | { action: "export"; id: string }
  | { action: "delete"; id: string };

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
  },
): PluginView {
  return {
    id: plugin.id,
    name: plugin.name,
    enabled: plugin.enabled,
    builtin: plugin.builtin === true,
    timeoutMs: plugin.timeoutMs,
    debug: plugin.debug,
    ...(plugin.help ? { help: plugin.help } : {}),
    ...(plugin.usage ? { usage: plugin.usage } : {}),
    ...(plugin.settings ? { settings: { ...plugin.settings } } : {}),
    ...(plugin.settingsSchema ? { settingsSchema: plugin.settingsSchema } : {}),
    ...(plugin.bundle ? { bundle: plugin.bundle } : {}),
    status: opts.status,
    hotSettings: opts.hotSettings,
    hasCode: typeof plugin.code === "string",
    codeLength: plugin.code?.length ?? 0,
    restartRequired: opts.restartRequired,
    staged: opts.staged === true,
    removalPending: opts.removalPending === true,
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
  if (action === "export" || action === "delete") {
    if (typeof value.id !== "string" || !value.id.trim()) {
      return { problem: `${action} needs a plugin id` };
    }
    return { command: { action, id: value.id.trim() } };
  }
  return { problem: "unknown plugins command" };
}
