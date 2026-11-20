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
  SUPPORTED_PLUGIN_API,
  pluginBundleOf,
  pluginSettingsSchema,
  validPluginId,
  type AdapterPlugin,
  type PluginBundle,
  type PluginSettingDef,
} from "./plugin-ops";
import type { ImportedPlugin } from "./plugin-file";

export interface PluginManifest {
  id: string;
  name: string;
  /** Plugin API the code needs; absent means 1. */
  api?: number;
  /** Display version from the manifest. */
  version?: string;
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

export interface PluginWriteHost extends PluginFileHost {
  writeFileAsync(adapter: string, path: string, text: string): Promise<void>;
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
    // The controller's promise resolves to `{ file, mimeType }`; the callback
    // form hands out the bytes directly. Accept both.
    const raw = await host.readFileAsync(META_ADAPTER, path);
    const value =
      raw != null && typeof raw === "object" && "file" in raw
        ? (raw as { file: unknown }).file
        : raw;
    if (typeof value === "string") return value;
    if (Buffer.isBuffer(value)) return value.toString("utf8");
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
  const rawApi = raw.api === undefined ? 1 : raw.api;
  if (typeof rawApi !== "number" || !Number.isInteger(rawApi) || rawApi < 1) {
    return { problem: `plugins/${pluginId}/plugin.json has an invalid api.` };
  }
  if (rawApi > SUPPORTED_PLUGIN_API) {
    return {
      problem: `plugins/${pluginId}/plugin.json needs iHome plugin API ${rawApi}; update iHome.`,
    };
  }
  let version: string | undefined;
  if (raw.version !== undefined) {
    if (typeof raw.version !== "string") {
      return {
        problem: `plugins/${pluginId}/plugin.json has an invalid version.`,
      };
    }
    version = raw.version.trim();
    if (!version || version.length > 32) {
      return {
        problem: `plugins/${pluginId}/plugin.json has an invalid version.`,
      };
    }
  }

  const code = await readText(host, `${PLUGIN_DIR}/${pluginId}/index.js`);
  if (code === null || !code.trim()) {
    return { problem: `plugins/${pluginId}/index.js is missing.` };
  }
  if (code.length > MAX_PLUGIN_CODE) {
    return { problem: `plugins/${pluginId}/index.js is too large.` };
  }

  const settingsSchema =
    raw.settingsSchema === undefined
      ? undefined
      : pluginSettingsSchema(raw.settingsSchema);
  if (raw.settingsSchema !== undefined && !settingsSchema) {
    return {
      problem: `plugins/${pluginId}/plugin.json has an invalid settings schema.`,
    };
  }
  const bundle =
    raw.bundle === undefined ? undefined : pluginBundleOf(raw.bundle);
  if (raw.bundle !== undefined && !bundle) {
    return {
      problem: `plugins/${pluginId}/plugin.json has an invalid device bundle.`,
    };
  }

  const manifest: PluginManifest = {
    id: pluginId,
    name,
    api: rawApi,
    ...(version ? { version } : {}),
    ...(text(raw.help, MAX_PLUGIN_HELP)
      ? { help: text(raw.help, MAX_PLUGIN_HELP) }
      : {}),
    ...(text(raw.usage, MAX_PLUGIN_USAGE)
      ? { usage: text(raw.usage, MAX_PLUGIN_USAGE) }
      : {}),
    ...(settingsSchema ? { settingsSchema } : {}),
    ...(bundle ? { bundle } : {}),
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
    ...(manifest.api !== undefined ? { api: manifest.api } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
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

/** Make a config plugin's folder usable. Existing good files win; a broken
 *  folder is rewritten from the config code before that code is stripped. */
export async function ensurePluginFiles(
  host: PluginWriteHost,
  plugin: AdapterPlugin,
): Promise<{ ok: true } | { problem: string }> {
  const existing = await readPluginFiles(host, plugin.id);
  if (!("problem" in existing)) return { ok: true };
  if (!plugin.code?.trim()) return { problem: existing.problem };
  try {
    await host.writeFileAsync(
      META_ADAPTER,
      `${PLUGIN_DIR}/${plugin.id}/plugin.json`,
      JSON.stringify(pluginManifestOf(plugin), null, 2),
    );
    await host.writeFileAsync(
      META_ADAPTER,
      `${PLUGIN_DIR}/${plugin.id}/index.js`,
      plugin.code,
    );
  } catch (error) {
    return { problem: String(error) };
  }
  const back = await readPluginFiles(host, plugin.id);
  return "problem" in back ? { problem: back.problem } : { ok: true };
}

/** The portable half of a config plugin: what belongs in `plugin.json`. */
export function pluginManifestOf(
  plugin: Pick<
    AdapterPlugin,
    | "id"
    | "name"
    | "api"
    | "version"
    | "help"
    | "usage"
    | "settingsSchema"
    | "bundle"
  >,
): PluginManifest {
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.api !== undefined ? { api: plugin.api } : {}),
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.help ? { help: plugin.help } : {}),
    ...(plugin.usage ? { usage: plugin.usage } : {}),
    ...(plugin.settingsSchema ? { settingsSchema: plugin.settingsSchema } : {}),
    ...(plugin.bundle ? { bundle: plugin.bundle } : {}),
  };
}

/**
 * Adopt a retired built-in entry as a file plugin: write the artifact into
 * `ihome.meta/plugins/<id>/` (an existing valid folder stays untouched) and
 * return the runtime entry without `builtin`. A failed write reports a problem
 * so the caller can keep the built-in fallback.
 */
export async function adoptFilePlugin(
  host: PluginWriteHost,
  entry: AdapterPlugin,
  artifact: ImportedPlugin,
): Promise<{ entry: AdapterPlugin } | { problem: string }> {
  const ensured = await ensurePluginFiles(host, {
    ...runtimeOnly({ ...entry, builtin: false }),
    name: artifact.name,
    ...(artifact.api !== undefined ? { api: artifact.api } : {}),
    ...(artifact.version ? { version: artifact.version } : {}),
    ...(artifact.help ? { help: artifact.help } : {}),
    ...(artifact.usage ? { usage: artifact.usage } : {}),
    ...(artifact.settingsSchema
      ? { settingsSchema: artifact.settingsSchema }
      : {}),
    ...(artifact.bundle ? { bundle: artifact.bundle } : {}),
    code: artifact.code,
  });
  if ("problem" in ensured) return { problem: ensured.problem };
  return {
    entry: {
      ...runtimeOnly({ ...entry, builtin: false }),
      name: artifact.name,
    },
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
