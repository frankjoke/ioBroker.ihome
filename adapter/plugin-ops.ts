/** One configured adapter-side plugin, stored under `native.plugins`. */
export interface AdapterPlugin {
  id: string;
  name: string;
  enabled: boolean;
  builtin?: boolean;
  timeoutMs: number;
  /** Gates `api.log.debug`; info/warn/error always pass. */
  debug: boolean;
  /** Long-form Markdown help. */
  help?: string;
  /** Markdown usage/payload examples. */
  usage?: string;
  /** Non-secret runtime settings, visible to the plugin as `api.settings`. */
  settings?: Record<string, unknown>;
  /** Optional form schema for the Plugins page. */
  settingsSchema?: PluginSettingDef[];
  code?: string;
}

export interface PluginSettingDef {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "json";
  default?: string | number | boolean;
  description?: string;
  options?: string[];
}

export interface BuiltinPluginDef {
  id: string;
  name: string;
  help?: string;
  usage?: string;
  settingsSchema?: PluginSettingDef[];
}

export type PluginReply =
  { ok: true; result: unknown } | { ok: false; error: string };

export interface PluginMessage {
  id: string;
  payload?: unknown;
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginDef[] = [
  {
    id: "network.info",
    name: "Network device info",
    help: "Shows the network devices iHome knows about — for example a phone, tablet or TV — or one device by its id.",
    usage: [
      "**From a logic**",
      "",
      "```js",
      'call("network.info", options, (data, error) => {',
      '  if (error) return log("info failed: " + error);',
      '  set("0_userdata.0.tv.host", data.host);',
      "});",
      "```",
      "",
      "**Options**",
      "",
      "```ts",
      "{ id?: string } // optional: omit to list all network devices",
      "```",
      "",
      "**From an HTML tile**",
      "",
      "```js",
      'const tv = await ihome.call("network.info", { id: "WZ_TV" });',
      "```",
      "",
      "Without an `id` it returns `{ devices: [...] }`.",
    ].join("\n"),
  },
  {
    id: "network.wake",
    name: "Wake-on-LAN",
    help: "Try to switch a device on using the Wake-on-LAN protocol. The MAC address of the device is required; it can come from Network devices or be passed directly.",
    usage: [
      "**From a logic**",
      "",
      "```js",
      'call("network.wake", options, (data, error) => {',
      "  if (error) log(error);",
      "});",
      "```",
      "",
      "**Options**",
      "",
      "```ts",
      "{",
      "  mac: string,        // required: six two-digit hex numbers separated by ':'",
      "                      // e.g. 'CC:CD:11:12:80:88'",
      "  ip?: string,        // optional: device IPv4 address, used for the directed",
      "                      // broadcast (alias: host)",
      "  broadcast?: string, // optional: explicit IPv4 broadcast address",
      "  port?: number,      // optional: UDP port, default 9",
      "  timeout?: number,   // optional: send timeout in ms, 100-10000, default 2000",
      "}",
      "```",
      "",
      "**By Network device** — `{ id }` is still valid and uses the host and MAC from Network devices:",
      "",
      "```js",
      'call("network.wake", { id: "WZ_TV" }, (data, error) => {',
      "  if (error) log(error);",
      "});",
      "```",
      "",
      "**Directly by MAC** — for a device that is not in Network devices:",
      "",
      "```js",
      'call("network.wake", { mac: "CC:CD:11:12:80:88", ip: "192.168.178.23" }, (data, error) => {',
      "  if (error) log(error);",
      "});",
      "```",
      "",
      "**From an HTML tile**",
      "",
      "```js",
      'await ihome.call("network.wake", { mac: "CC:CD:11:12:80:88", ip: "192.168.178.23" });',
      "```",
      "",
      "An IP address cannot find the MAC of a switched-off device; WoL needs the MAC. `ip` only chooses the broadcast target.",
    ].join("\n"),
  },
  {
    id: "http.in",
    name: "HTTP input",
    help: "Receives data from devices or webhooks and writes it to iHome states.",
    usage: [
      "**From a weather station (GET)**",
      "",
      "```text",
      "http://iobroker:8095/easyweather?tempf=70&humidity=55",
      "```",
      "",
      "**From IFTTT or another webhook (POST)**",
      "",
      "```text",
      'curl -X POST http://iobroker:8095/ifttt -H "Content-Type: application/json" -d \'{"kind":"test","tempf":70}\'',
      "```",
      "",
      "**Endpoints (JSON)**",
      "",
      "```json",
      "[",
      '  { "path": "easyweather", "method": "GET", "reply": "success", "target": "0_userdata.0.Weather.json" },',
      '  { "path": "ifttt", "method": "POST", "targets": [',
      '    { "state": "0_userdata.0.Inbound.last", "type": "string", "value": "$" },',
      '    { "state": "0_userdata.0.Weather.temp", "type": "number",',
      '      "role": "value.temperature", "unit": "°C",',
      '      "value": "$.tempf", "transform": "(Number(value) - 32) * 5 / 9" }',
      "  ] }",
      "]",
      "```",
      "",
      "- `target` writes the whole request as JSON to one state; a logic/template distributes it.",
      "- `targets` writes values directly. `value` and `transform` are JS expressions; `$` is the request object.",
      "- `reply` is returned on success: a string is sent as text, anything else as JSON. Without it the plugin returns `{ok:true,wrote:n}`.",
      "- `name`, `type`, `role` and `unit` are used only when the target state is missing.",
      "- Set a `token` and send it as `?token=...` or `X-iHome-Token` when the endpoint is reachable from outside.",
      "- Bind `127.0.0.1` when only the ioBroker proxy should reach it; `0.0.0.0` for LAN devices.",
    ].join("\n"),
    settingsSchema: [
      {
        name: "bind",
        label: "Bind address",
        type: "string",
        default: "0.0.0.0",
        description:
          "0.0.0.0 for LAN devices; 127.0.0.1 when only the ioBroker proxy should reach it.",
      },
      {
        name: "port",
        label: "Port",
        type: "number",
        default: 8095,
        description: "Port the HTTP server listens on.",
      },
      {
        name: "token",
        label: "Token",
        type: "string",
        description:
          "Optional shared secret. Send it as ?token=... or X-iHome-Token.",
      },
      {
        name: "endpoints",
        label: "Endpoints (JSON)",
        type: "json",
        default: "[]",
        description:
          "JSON array of endpoints and targets. See Usage for the format.",
      },
    ],
  },
];

export const DEFAULT_PLUGIN_TIMEOUT_MS = 5000;
export const MIN_PLUGIN_TIMEOUT_MS = 100;
export const MAX_PLUGIN_TIMEOUT_MS = 30_000;
export const MAX_PLUGIN_CODE = 200_000;
export const MAX_PLUGIN_HELP = 20_000;
export const MAX_PLUGIN_USAGE = 20_000;
export const MAX_PLUGIN_SETTINGS = 20_000;
export const MAX_SETTING_FIELDS = 40;

const ID = /^[a-z][a-z0-9._-]{0,63}$/;
const SETTING_TYPES = [
  "string",
  "number",
  "boolean",
  "select",
  "json",
] as const;

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

function textOf(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function jsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function jsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return false;
}

export function pluginSettings(
  value: unknown,
): Record<string, unknown> | undefined {
  const parsed = jsonish(value);
  if (!record(parsed)) return undefined;
  try {
    if (
      JSON.stringify(parsed).length > MAX_PLUGIN_SETTINGS ||
      !Object.values(parsed).every(jsonValue)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function settingDef(value: unknown): PluginSettingDef | null {
  if (!record(value)) return null;
  const name = textOf(value.name, 64);
  const label = textOf(value.label, 80);
  const type = SETTING_TYPES.find((candidate) => candidate === value.type);
  if (!name || !label || !type) return null;
  const def: PluginSettingDef = { name, label, type };
  if (value.description !== undefined) {
    const description = textOf(value.description, 500);
    if (!description) return null;
    def.description = description;
  }
  if (value.default !== undefined) {
    if (
      typeof value.default !== "string" &&
      typeof value.default !== "number" &&
      typeof value.default !== "boolean"
    ) {
      return null;
    }
    def.default = value.default;
  }
  if (type === "select") {
    if (
      !Array.isArray(value.options) ||
      value.options.length === 0 ||
      value.options.length > 50 ||
      !value.options.every((option) => textOf(option, 80))
    ) {
      return null;
    }
    def.options = value.options as string[];
  }
  if (type === "json" && value.default !== undefined) {
    if (typeof value.default !== "string") return null;
  }
  return def;
}

export function pluginSettingsSchema(
  value: unknown,
): PluginSettingDef[] | undefined {
  const parsed = jsonish(value);
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  if (parsed.length > MAX_SETTING_FIELDS) return undefined;
  const schema: PluginSettingDef[] = [];
  for (const entry of parsed) {
    const def = settingDef(entry);
    if (!def) return undefined;
    schema.push(def);
  }
  return schema;
}

/** Strict check used when a page/import writes settings. */
export function settingsProblem(
  schema: PluginSettingDef[] | undefined,
  settings: Record<string, unknown> | undefined,
): string | null {
  if (!settings) return null;
  if (!record(settings)) return "settings must be an object";
  if (!schema) return null;
  for (const def of schema) {
    const value = settings[def.name];
    if (value === undefined) continue;
    if (def.type === "string" && typeof value !== "string") {
      return `settings.${def.name} must be a string`;
    }
    if (
      def.type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      return `settings.${def.name} must be a number`;
    }
    if (def.type === "boolean" && typeof value !== "boolean") {
      return `settings.${def.name} must be a boolean`;
    }
    if (
      def.type === "select" &&
      (typeof value !== "string" || !def.options?.includes(value))
    ) {
      return `settings.${def.name} must be one of ${def.options?.join(", ")}`;
    }
    if (def.type === "json") {
      if (typeof value !== "string") {
        return `settings.${def.name} must be a JSON string`;
      }
      try {
        JSON.parse(value);
      } catch {
        return `settings.${def.name} must be valid JSON`;
      }
    }
  }
  return null;
}

export function validPluginId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
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
  if (!validPluginId(id)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 64) return null;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return null;
  }

  const builtin = builtinDef(id, builtins);
  const settings = pluginSettings(value.settings);
  if (value.builtin === true) {
    if (!builtin) return null;
    return {
      id,
      name: builtin.name,
      enabled: value.enabled !== false,
      builtin: true,
      timeoutMs: timeoutOf(value.timeoutMs),
      debug: value.debug === true,
      ...(builtin.help ? { help: builtin.help } : {}),
      ...(builtin.usage ? { usage: builtin.usage } : {}),
      ...(builtin.settingsSchema
        ? { settingsSchema: builtin.settingsSchema }
        : {}),
      ...(settings ? { settings } : {}),
      code: undefined,
    };
  }
  // A builtin id is reserved for the shipped implementation.
  if (builtin) return null;

  if (typeof value.code !== "string" || value.code.trim() === "") return null;
  if (value.code.length > MAX_PLUGIN_CODE) return null;
  const help = textOf(value.help, MAX_PLUGIN_HELP);
  const usage = textOf(value.usage, MAX_PLUGIN_USAGE);
  const settingsSchema = pluginSettingsSchema(value.settingsSchema);
  return {
    id,
    name,
    enabled: value.enabled !== false,
    builtin: false,
    timeoutMs: timeoutOf(value.timeoutMs),
    debug: value.debug === true,
    ...(help ? { help } : {}),
    ...(usage ? { usage } : {}),
    ...(settings ? { settings } : {}),
    ...(settingsSchema ? { settingsSchema } : {}),
    code: value.code,
  };
}

/** The valid, unique plugin entries of a native config array. */
export function validAdapterPlugins(
  value: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
  log?: (message: string) => void,
): AdapterPlugin[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      log?.("plugin list: expected an array");
    }
    return [];
  }
  const seen = new Set<string>();
  const plugins: AdapterPlugin[] = [];
  for (const [index, entry] of value.entries()) {
    const plugin = validEntry(entry, builtins);
    if (!plugin) {
      const id =
        record(entry) && typeof entry.id === "string"
          ? entry.id
          : `#${index + 1}`;
      log?.(`plugin list: ignoring invalid entry ${id}`);
      continue;
    }
    if (seen.has(plugin.id)) {
      log?.(`plugin list: ignoring duplicate plugin ${plugin.id}`);
      continue;
    }
    seen.add(plugin.id);
    plugins.push(plugin);
  }
  return plugins;
}

/** Valid entries plus every missing builtin, enabled by default. */
export function seedBuiltinPlugins(
  value: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
  log?: (message: string) => void,
): AdapterPlugin[] {
  const plugins = validAdapterPlugins(value, builtins, log);
  const ids = new Set(plugins.map((plugin) => plugin.id));
  for (const builtin of builtins) {
    if (ids.has(builtin.id)) continue;
    plugins.push({
      id: builtin.id,
      name: builtin.name,
      enabled: true,
      builtin: true,
      timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
      debug: false,
      ...(builtin.help ? { help: builtin.help } : {}),
      ...(builtin.usage ? { usage: builtin.usage } : {}),
      ...(builtin.settingsSchema
        ? { settingsSchema: builtin.settingsSchema }
        : {}),
      code: undefined,
    });
  }
  return plugins;
}

/**
 * The config to persist when seeding builtins: the raw entries stay untouched
 * (invalid ones are only ignored at runtime and logged), plus every missing
 * builtin. Never persist the filtered list, which would delete admin data.
 */
export function pluginConfigWithBuiltins(
  raw: unknown,
  builtins: readonly BuiltinPluginDef[] = BUILTIN_PLUGINS,
): unknown[] {
  const current = Array.isArray(raw) ? raw : [];
  const validBuiltinIds = new Set(
    validAdapterPlugins(raw, builtins)
      .filter((plugin) => plugin.builtin)
      .map((plugin) => plugin.id),
  );
  const missing = builtins
    .filter((builtin) => !validBuiltinIds.has(builtin.id))
    .map((builtin) => ({
      id: builtin.id,
      name: builtin.name,
      enabled: true,
      builtin: true,
      timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
      debug: false,
      code: undefined,
    }));
  return [...current, ...missing];
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
