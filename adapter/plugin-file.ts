import {
  BUILTIN_PLUGINS,
  DEFAULT_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_CODE,
  MAX_PLUGIN_HELP,
  MAX_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_USAGE,
  MIN_PLUGIN_TIMEOUT_MS,
  pluginSettings,
  pluginSettingsSchema,
  settingsProblem,
  validPluginId,
  type BuiltinPluginDef,
  type PluginSettingDef,
} from "./plugin-ops";

/** The portable plugin shape: no `enabled`, no `builtin`, code included. */
export interface ImportedPlugin {
  id: string;
  name: string;
  timeoutMs?: number;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
  settingsSchema?: PluginSettingDef[];
  code: string;
}

export interface PluginFile {
  format: "ihome-plugin";
  version: 1;
  plugin: ImportedPlugin;
}

export const PLUGIN_FILE_FORMAT = "ihome-plugin";
export const PLUGIN_FILE_VERSION = 1;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function problem(message: string): { problem: string } {
  return { problem: message };
}

/** Strict parse of an imported plugin file; the adapter re-validates on save. */
export function parsePluginFile(
  raw: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
): { plugin: ImportedPlugin } | { problem: string } {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return problem("The file is not valid JSON.");
    }
  }
  if (!record(value)) return problem("The file must contain a plugin object.");
  if (value.format !== PLUGIN_FILE_FORMAT) {
    return problem(`The file format must be "${PLUGIN_FILE_FORMAT}".`);
  }
  if (value.version !== PLUGIN_FILE_VERSION) {
    return problem(`The file version must be ${PLUGIN_FILE_VERSION}.`);
  }
  if (!record(value.plugin)) {
    return problem("The file has no plugin object.");
  }

  const plugin = value.plugin;
  if (!validPluginId(plugin.id)) {
    return problem(
      "The plugin id must match a-z, 0-9, dot, dash or underscore.",
    );
  }
  if (builtins.some((builtin) => builtin.id === plugin.id)) {
    return problem("That id is reserved for a built-in plugin.");
  }
  const name = typeof plugin.name === "string" ? plugin.name.trim() : "";
  if (!name || name.length > 64) {
    return problem("The plugin name must be 1 to 64 characters.");
  }
  const code = typeof plugin.code === "string" ? plugin.code : "";
  if (!code.trim()) return problem("The plugin needs non-empty code.");
  if (code.length > MAX_PLUGIN_CODE) {
    return problem(
      `The plugin code must be at most ${MAX_PLUGIN_CODE} characters.`,
    );
  }
  if (
    plugin.help !== undefined &&
    (typeof plugin.help !== "string" || plugin.help.length > MAX_PLUGIN_HELP)
  ) {
    return problem(`Help must be at most ${MAX_PLUGIN_HELP} characters.`);
  }
  if (
    plugin.usage !== undefined &&
    (typeof plugin.usage !== "string" || plugin.usage.length > MAX_PLUGIN_USAGE)
  ) {
    return problem(`Usage must be at most ${MAX_PLUGIN_USAGE} characters.`);
  }
  if (
    plugin.timeoutMs !== undefined &&
    (typeof plugin.timeoutMs !== "number" || !Number.isFinite(plugin.timeoutMs))
  ) {
    return problem("The timeout must be a number.");
  }
  if (plugin.settings !== undefined && !record(plugin.settings)) {
    return problem("Settings must be a JSON object.");
  }
  if (
    plugin.settingsSchema !== undefined &&
    !Array.isArray(plugin.settingsSchema)
  ) {
    return problem("The settings schema must be an array.");
  }

  const settings =
    plugin.settings !== undefined ? pluginSettings(plugin.settings) : undefined;
  if (plugin.settings !== undefined && !settings) {
    return problem("Settings are too large or not JSON-safe.");
  }
  const settingsSchema =
    plugin.settingsSchema !== undefined
      ? pluginSettingsSchema(plugin.settingsSchema)
      : undefined;
  if (plugin.settingsSchema !== undefined && !settingsSchema) {
    return problem("The settings schema is invalid.");
  }
  const settingsError = settingsProblem(settingsSchema, settings);
  if (settingsError) return problem(settingsError);

  const timeoutMs =
    typeof plugin.timeoutMs === "number"
      ? Math.min(
          MAX_PLUGIN_TIMEOUT_MS,
          Math.max(MIN_PLUGIN_TIMEOUT_MS, Math.round(plugin.timeoutMs)),
        )
      : DEFAULT_PLUGIN_TIMEOUT_MS;
  const help =
    typeof plugin.help === "string" && plugin.help.trim()
      ? plugin.help.trim()
      : undefined;
  const usage =
    typeof plugin.usage === "string" && plugin.usage.trim()
      ? plugin.usage.trim()
      : undefined;

  return {
    plugin: {
      id: plugin.id,
      name,
      code,
      timeoutMs,
      ...(help ? { help } : {}),
      ...(usage ? { usage } : {}),
      ...(settings ? { settings } : {}),
      ...(settingsSchema ? { settingsSchema } : {}),
    },
  };
}

export function pluginFile(plugin: ImportedPlugin): PluginFile {
  return {
    format: PLUGIN_FILE_FORMAT,
    version: PLUGIN_FILE_VERSION,
    plugin: { ...plugin },
  };
}

export function serializePluginFile(file: PluginFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
