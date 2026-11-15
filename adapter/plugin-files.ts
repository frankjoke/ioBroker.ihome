// Plugin content lives as files in the shared space:
//   ihome.meta/plugins/<id>/plugin.json   portable manifest
//   ihome.meta/plugins/<id>/index.js      the code the host runs
// Runtime flags (enabled/debug/timeout/settings) stay in the adapter config.
// This module only reads and merges; wiring lives in main.ts.

import {
  DEFAULT_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_CODE,
  MAX_PLUGIN_HELP,
  MAX_PLUGIN_USAGE,
  validPluginId,
  type AdapterPlugin,
  type PluginBundle,
  type PluginSettingDef,
} from "./plugin-ops";

export interface PluginManifest {
  id: string;
  name: string;
  help?: string;
  usage?: string;
  settingsSchema?: PluginSettingDef[];
  bundle?: PluginBundle;
}

export interface PluginRuntime {
  enabled?: boolean;
  debug?: boolean;
  timeoutMs?: number;
  settings?: Record<string, unknown>;
}

export interface PluginFiles {
  manifest: PluginManifest;
  code: string;
}

/** The file requests this module needs; the adapter class provides them. */
export interface PluginFileHost {
  readDirAsync(
    adapter: string,
    path: string,
  ): Promise<{ file: string; isDir?: boolean }[] | undefined>;
  readFileAsync(adapter: string, path: string): Promise<unknown>;
}

const META_ADAPTER = "ihome.meta";
const PLUGIN_DIR = "plugins";

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

async function readText(
  host: PluginFileHost,
  path: string,
): Promise<string | null> {
  try {
    const raw = await host.readFileAsync(META_ADAPTER, path);
    if (typeof raw === "string") return raw;
    if (Buffer.isBuffer(raw)) return raw.toString("utf8");
    return null;
  } catch {
    return null;
  }
}

/** The plugin ids present as folders in the shared space. */
export async function listPluginFolders(
  host: PluginFileHost,
  log?: (message: string) => void,
): Promise<string[]> {
  let rows: { file: string; isDir?: boolean }[] | undefined;
  try {
    rows = await host.readDirAsync(META_ADAPTER, PLUGIN_DIR);
  } catch (error) {
    log?.(`plugins: cannot list ${PLUGIN_DIR}: ${String(error)}`);
    return [];
  }
  if (!Array.isArray(rows)) {
    log?.(`plugins: ${PLUGIN_DIR} is not a folder`);
    return [];
  }
  return (
    rows
      // Some controllers omit `isDir`; only a plain file is ruled out.
      .filter((row) => row.isDir !== false && validPluginId(row.file))
      .map((row) => row.file)
      .sort()
  );
}

/** Read one plugin folder; a broken manifest is reported, not guessed. */
export async function readPluginFiles(
  host: PluginFileHost,
  id: string,
): Promise<{ files: PluginFiles } | { problem: string }> {
  const pluginId =
    typeof id === "string" && validPluginId(id.trim()) ? id.trim() : undefined;
  if (!pluginId) return { problem: `Unknown plugin id: ${id}` };

  const manifestText = await readText(
    host,
    `${PLUGIN_DIR}/${pluginId}/plugin.json`,
  );
  if (manifestText === null) {
    return { problem: `plugins/${pluginId}/plugin.json is missing.` };
  }
  let raw: unknown = manifestText;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    return { problem: `plugins/${pluginId}/plugin.json is not valid JSON.` };
  }
  if (!record(raw))
    return { problem: `plugins/${pluginId}/plugin.json must be an object.` };
  if (raw.id !== undefined && raw.id !== pluginId) {
    return { problem: `plugins/${pluginId}/plugin.json names another id.` };
  }
  const name = text(raw.name, 120);
  if (!name)
    return { problem: `plugins/${pluginId}/plugin.json needs a name.` };

  const code = await readText(host, `${PLUGIN_DIR}/${pluginId}/index.js`);
  if (code === null || !code.trim()) {
    return { problem: `plugins/${pluginId}/index.js is missing.` };
  }
  if (code.length > MAX_PLUGIN_CODE) {
    return { problem: `plugins/${pluginId}/index.js is too large.` };
  }

  const manifest: PluginManifest = {
    id: pluginId,
    name,
    ...(text(raw.help, MAX_PLUGIN_HELP)
      ? { help: text(raw.help, MAX_PLUGIN_HELP) }
      : {}),
    ...(text(raw.usage, MAX_PLUGIN_USAGE)
      ? { usage: text(raw.usage, MAX_PLUGIN_USAGE) }
      : {}),
    ...(Array.isArray(raw.settingsSchema)
      ? { settingsSchema: raw.settingsSchema as PluginSettingDef[] }
      : {}),
    ...(record(raw.bundle)
      ? { bundle: raw.bundle as unknown as PluginBundle }
      : {}),
  };
  return { files: { manifest, code } };
}

/** File content plus the config's runtime flags → the shape the host starts. */
export function mergePlugin(
  files: PluginFiles,
  runtime: PluginRuntime = {},
): AdapterPlugin {
  const { manifest, code } = files;
  const timeoutMs =
    typeof runtime.timeoutMs === "number" && Number.isFinite(runtime.timeoutMs)
      ? runtime.timeoutMs
      : DEFAULT_PLUGIN_TIMEOUT_MS;
  return {
    id: manifest.id,
    name: manifest.name,
    enabled: runtime.enabled === true,
    builtin: false,
    timeoutMs,
    debug: runtime.debug === true,
    ...(manifest.help ? { help: manifest.help } : {}),
    ...(manifest.usage ? { usage: manifest.usage } : {}),
    ...(runtime.settings ? { settings: runtime.settings } : {}),
    ...(manifest.settingsSchema
      ? { settingsSchema: manifest.settingsSchema }
      : {}),
    ...(manifest.bundle ? { bundle: manifest.bundle } : {}),
    code,
  };
}

/** The portable half of a config plugin: what belongs in `plugin.json`. */
export function pluginManifestOf(plugin: AdapterPlugin): PluginManifest {
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.help ? { help: plugin.help } : {}),
    ...(plugin.usage ? { usage: plugin.usage } : {}),
    ...(plugin.settingsSchema ? { settingsSchema: plugin.settingsSchema } : {}),
    ...(plugin.bundle ? { bundle: plugin.bundle } : {}),
  };
}

/** The runtime half kept in config: no code, schema, help or bundle. */
export function runtimeOnly(plugin: AdapterPlugin): AdapterPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    enabled: plugin.enabled,
    ...(plugin.builtin ? { builtin: true } : {}),
    timeoutMs: plugin.timeoutMs,
    debug: plugin.debug,
  };
}
