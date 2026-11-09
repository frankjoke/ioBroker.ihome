import {
  DEFAULT_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_HELP,
  MAX_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_USAGE,
  MIN_PLUGIN_TIMEOUT_MS,
  pluginSettings,
  pluginSettingsSchema,
  type AdapterPlugin,
  type PluginSettingDef,
} from "./plugin-ops";
import { parsePluginFile, type ImportedPlugin } from "./plugin-file";

/** Page-managed plugin data, kept out of `native.plugins` so edits hot-apply. */
export interface PluginSettingsEntry {
  enabled: boolean;
  timeoutMs: number;
  debug: boolean;
  help?: string;
  usage?: string;
  settings?: Record<string, unknown>;
  settingsSchema?: PluginSettingDef[];
}

export interface PluginSettingsDocument {
  version: 1;
  settings: Record<string, PluginSettingsEntry>;
  /** Imports waiting for the next adapter start. */
  staged: ImportedPlugin[];
  /** User plugin ids to remove on the next adapter start. */
  removals: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function timeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PLUGIN_TIMEOUT_MS;
  }
  return Math.min(
    MAX_PLUGIN_TIMEOUT_MS,
    Math.max(MIN_PLUGIN_TIMEOUT_MS, Math.round(value)),
  );
}

/** The settings document seeded from the merged plugin list. */
export function pluginSettingsDoc(
  plugins: AdapterPlugin[],
): PluginSettingsDocument {
  const settings: Record<string, PluginSettingsEntry> = {};
  for (const plugin of plugins) {
    settings[plugin.id] = {
      enabled: plugin.enabled,
      timeoutMs: plugin.timeoutMs,
      debug: plugin.debug,
      ...(plugin.help ? { help: plugin.help } : {}),
      ...(plugin.usage ? { usage: plugin.usage } : {}),
      ...(plugin.settings ? { settings: plugin.settings } : {}),
      ...(plugin.settingsSchema
        ? { settingsSchema: plugin.settingsSchema }
        : {}),
    };
  }
  return { version: 1, settings, staged: [], removals: [] };
}

/** Apply the page-managed values over the native code entries. */
export function mergePluginSettings(
  native: AdapterPlugin[],
  doc: PluginSettingsDocument,
): AdapterPlugin[] {
  return native.map((plugin) => {
    const entry = doc.settings[plugin.id];
    if (!entry) return plugin;
    const builtin = plugin.builtin === true;
    const next: AdapterPlugin = {
      ...plugin,
      enabled: entry.enabled,
      timeoutMs: entry.timeoutMs,
      debug: entry.debug,
    };
    if (!builtin) {
      if (entry.help) next.help = entry.help;
      else delete next.help;
      if (entry.usage) next.usage = entry.usage;
      else delete next.usage;
      if (entry.settingsSchema) next.settingsSchema = entry.settingsSchema;
      else delete next.settingsSchema;
    }
    if (entry.settings) next.settings = entry.settings;
    else delete next.settings;
    return next;
  });
}

export function normalizeSettingsDoc(
  value: unknown,
): PluginSettingsDocument | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!record(parsed)) return null;
  const settings: Record<string, PluginSettingsEntry> = {};
  if (record(parsed.settings)) {
    for (const [id, raw] of Object.entries(parsed.settings)) {
      if (!record(raw)) continue;
      if (typeof raw.enabled !== "boolean") continue;
      const entry: PluginSettingsEntry = {
        enabled: raw.enabled,
        timeoutMs: timeout(raw.timeoutMs),
        debug: raw.debug === true,
      };
      const help = text(raw.help, MAX_PLUGIN_HELP);
      const usage = text(raw.usage, MAX_PLUGIN_USAGE);
      const values = pluginSettings(raw.settings);
      const schema = pluginSettingsSchema(raw.settingsSchema);
      if (help) entry.help = help;
      if (usage) entry.usage = usage;
      if (values) entry.settings = values;
      if (schema) entry.settingsSchema = schema;
      settings[id] = entry;
    }
  }
  const staged: ImportedPlugin[] = [];
  if (Array.isArray(parsed.staged)) {
    for (const raw of parsed.staged) {
      const parsedFile = parsePluginFile({
        format: "ihome-plugin",
        version: 1,
        plugin: raw,
      });
      if ("plugin" in parsedFile) staged.push(parsedFile.plugin);
    }
  }
  const removals = Array.isArray(parsed.removals)
    ? [...new Set(parsed.removals.filter((id) => typeof id === "string"))]
    : [];
  return { version: 1, settings, staged, removals };
}

export function pluginSettingsChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function importStaged(
  doc: PluginSettingsDocument,
  plugin: ImportedPlugin,
): PluginSettingsDocument {
  return {
    ...doc,
    staged: [...doc.staged.filter((entry) => entry.id !== plugin.id), plugin],
    removals: doc.removals.filter((id) => id !== plugin.id),
  };
}

export function removeStaged(
  doc: PluginSettingsDocument,
  id: string,
): PluginSettingsDocument {
  return { ...doc, staged: doc.staged.filter((entry) => entry.id !== id) };
}

export function stageRemoval(
  doc: PluginSettingsDocument,
  id: string,
): PluginSettingsDocument {
  return {
    ...doc,
    staged: doc.staged.filter((entry) => entry.id !== id),
    removals: [...new Set([...doc.removals, id])],
  };
}
