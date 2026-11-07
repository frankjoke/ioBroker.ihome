/** One configured adapter-side plugin, stored under `native.plugins`. */
export interface AdapterPlugin {
  id: string;
  name: string;
  enabled: boolean;
  builtin?: boolean;
  timeoutMs: number;
  code?: string;
}

export interface BuiltinPluginDef {
  id: string;
  name: string;
}

export type PluginReply =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export interface PluginMessage {
  id: string;
  payload?: unknown;
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginDef[] = [
  { id: "network.info", name: "Network device info" },
  { id: "network.wake", name: "Wake-on-LAN" },
];

export const DEFAULT_PLUGIN_TIMEOUT_MS = 5000;
export const MIN_PLUGIN_TIMEOUT_MS = 100;
export const MAX_PLUGIN_TIMEOUT_MS = 30_000;
export const MAX_PLUGIN_CODE = 200_000;

const ID = /^[a-z][a-z0-9._-]{0,63}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function timeoutOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PLUGIN_TIMEOUT_MS;
  }
  return Math.min(
    MAX_PLUGIN_TIMEOUT_MS,
    Math.max(MIN_PLUGIN_TIMEOUT_MS, Math.round(value)),
  );
}

function builtinDef(
  id: string,
  builtins: readonly BuiltinPluginDef[],
): BuiltinPluginDef | undefined {
  return builtins.find((entry) => entry.id === id);
}

function validEntry(
  value: unknown,
  builtins: readonly BuiltinPluginDef[],
): AdapterPlugin | null {
  if (!record(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID.test(id)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 64) return null;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return null;
  }

  const builtin = builtinDef(id, builtins);
  if (value.builtin === true) {
    if (!builtin) return null;
    return {
      id,
      name: builtin.name,
      enabled: value.enabled !== false,
      builtin: true,
      timeoutMs: timeoutOf(value.timeoutMs),
      code: undefined,
    };
  }
  // A builtin id is reserved for the shipped implementation.
  if (builtin) return null;

  if (typeof value.code !== "string" || value.code.trim() === "") return null;
  if (value.code.length > MAX_PLUGIN_CODE) return null;
  return {
    id,
    name,
    enabled: value.enabled !== false,
    builtin: false,
    timeoutMs: timeoutOf(value.timeoutMs),
    code: value.code,
  };
}

/** The valid, unique plugin entries of a native config array. */
export function validAdapterPlugins(
  value: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
): AdapterPlugin[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const plugins: AdapterPlugin[] = [];
  for (const entry of value) {
    const plugin = validEntry(entry, builtins);
    if (!plugin || seen.has(plugin.id)) continue;
    seen.add(plugin.id);
    plugins.push(plugin);
  }
  return plugins;
}

/** Valid entries plus every missing builtin, enabled by default. */
export function seedBuiltinPlugins(
  value: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
): AdapterPlugin[] {
  const plugins = validAdapterPlugins(value, builtins);
  const ids = new Set(plugins.map((plugin) => plugin.id));
  for (const builtin of builtins) {
    if (ids.has(builtin.id)) continue;
    plugins.push({
      id: builtin.id,
      name: builtin.name,
      enabled: true,
      builtin: true,
      timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
      code: undefined,
    });
  }
  return plugins;
}

/** The `plugin` message payload, or the reason it cannot be used. */
export function parsePluginMessage(
  value: unknown,
): { ok: true; message: PluginMessage } | { ok: false; error: string } {
  if (!record(value)) return { ok: false, error: "invalid plugin message" };
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return { ok: false, error: "plugin message needs an id" };
  return {
    ok: true,
    message: {
      id,
      ...(value.payload !== undefined ? { payload: value.payload } : {}),
    },
  };
}

export function pluginReply(result: unknown): PluginReply {
  return { ok: true, result };
}

export function pluginError(error: unknown): PluginReply {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
