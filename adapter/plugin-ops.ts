/** One configured adapter-side plugin, stored under `native.plugins`. */
/** The plugin API this adapter hosts; a file needing a newer one is refused. */
export const SUPPORTED_PLUGIN_API = 1;

import type { PluginSettingDef, SettingsTabDef } from "./settings-schema";
import { parseSettingsTabs, pluginSettingsSchema } from "./settings-schema";
export {
  MAX_SETTING_FIELDS,
  MAX_SETTINGS_DEPTH,
  MAX_SETTINGS_FIELDS_TOTAL,
  parseSettingsSchema,
  parseSettingsTabs,
  pluginSettingsSchema,
  settingsProblem,
} from "./settings-schema";
export type {
  SettingsArrayItem,
  SettingsField,
  SettingsFieldType,
  SettingsObjectSchema,
  SettingsTabDef,
} from "./settings-schema";
export type { PluginSettingDef } from "./settings-schema";

export interface AdapterPlugin {
  id: string;
  name: string;
  /** Plugin API the code needs; absent means 1. */
  api?: number;
  /** Display version from the manifest. */
  version?: string;
  enabled: boolean;
  builtin?: boolean;
  timeoutMs: number;
  /** Gates `api.log.debug`; info/warn/error always pass. */
  debug: boolean;
  /** Hidden from the Plugins list outside the local network. A visibility
   *  layer, not an authorisation boundary. */
  secured?: boolean;
  /** Long-form Markdown help. */
  help?: string;
  /** Markdown usage/payload examples. */
  usage?: string;
  /** Non-secret runtime settings, visible to the plugin as `api.settings`. */
  settings?: Record<string, unknown>;
  /** Optional form schema for the Plugins page. */
  settingsSchema?: PluginSettingDef[];
  /** Optional tab layout over the settings schema. */
  settingsTabs?: SettingsTabDef[];
  /** Declarative device the UI creates when the plugin is enabled. */
  bundle?: PluginBundle;
  code?: string;
}

export interface PluginBundleControl {
  /** State path relative to the plugin base, or an absolute state id. */
  state: string;
  feature: string;
  label?: string;
  unit?: string;
  role?: string;
  type?: string;
  writable?: boolean;
  transform?: unknown;
}

export interface PluginBundleDevice {
  name?: string;
  type?: string;
  icon?: string;
  size?: { w: number; h: number };
  controls: PluginBundleControl[];
}

export interface PluginBundle {
  version: 1;
  device: PluginBundleDevice;
}

export interface BuiltinPluginDef {
  id: string;
  name: string;
  /** Default call timeout for this built-in (ms); falls back to the global. */
  timeoutMs?: number;
  /** Seeded hidden from the UI outside the local network. An explicit
   *  `secured: false` from the Plugins page overrides it. */
  secured?: boolean;
  help?: string;
  usage?: string;
  settingsSchema?: PluginSettingDef[];
  settingsTabs?: SettingsTabDef[];
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
      "**What it does**",
      "",
      "- The **Endpoints** tab holds one row per HTTP path; each row writes the request to iHome states.",
      "- The **Settings** tab holds the defaults: bind address, port and an optional default token.",
      "",
      "**Add an endpoint**",
      "",
      "1. Settings: `0.0.0.0` for LAN devices or `127.0.0.1` for proxy-only, a port (8095), optional default token.",
      "2. Endpoints -> **+ Add**: give a path (no leading slash) and a method.",
      "3. Pick one target mode:",
      "   - **Single target state** writes the whole request as JSON to one state; a logic/template distributes it.",
      "   - **Targets** writes values to states. `value` and `transform` are JS expressions; `$` is the request object.",
      "4. `reply` is the success body; `enabled` turns a configured endpoint off without deleting it.",
      "5. **Save** - the plugin restarts its listener with the new endpoints.",
      "",
      "**Weather station (GET)**",
      "",
      "```text",
      "http://iobroker:8095/easyweather?tempf=70&humidity=55",
      "```",
      "",
      "A target with `value: $.tempf` and `transform: (Number(value) - 32) * 5 / 9` writes °C.",
      "",
      "**Webhook (POST)**",
      "",
      "```text",
      'curl -X POST http://iobroker:8095/ifttt -H "Content-Type: application/json" -d \'{"kind":"test","tempf":70}\'',
      "```",
      "",
      "**Defaults and overrides**",
      "",
      "- An endpoint may override `bind`, `port`, `token` and `enabled`. Endpoints sharing a bind/port share one server.",
      "- `name`, `type`, `role` and `unit` are used only when the target state is missing; a missing `type` is inferred from the value.",
      "",
      "**Tokens**",
      "",
      "- Send the token as `?token=...` or `X-iHome-Token`.",
      "- An endpoint token overrides the default; an empty token means no token. Only leave a public endpoint tokenless on purpose.",
      "",
      "**Advanced**",
      "",
      "The settings value is the endpoint array itself. The editor has an *Edit as JSON* fallback for recovery. `reply` is preserved as stored (text or JSON) and edited there; JSON is never required.",
      "",
      "**Debug**",
      "",
      "Enable **Debug logs** to see each request, its status and the number of states written; request values are not logged.",
    ].join("\n"),
    settingsSchema: [
      {
        name: "bind",
        label: "Default bind address",
        type: "string",
        default: "0.0.0.0",
        description:
          "Used by endpoints without their own bind. 0.0.0.0 for LAN devices; 127.0.0.1 for proxy-only.",
      },
      {
        name: "port",
        label: "Default port",
        type: "number",
        default: 8095,
        description: "Used by endpoints without their own port.",
      },
      {
        name: "token",
        label: "Default token",
        type: "string",
        description:
          "Used by endpoints without their own token. Send it as ?token=... or X-iHome-Token.",
      },
      {
        name: "endpoints",
        label: "Endpoints",
        type: "array",
        item: {
          fields: [
            {
              name: "path",
              label: "Path",
              type: "string",
              required: true,
              description:
                "Request path without a leading slash, e.g. easyweather.",
            },
            {
              name: "method",
              label: "Method",
              type: "select",
              options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
              default: "GET",
            },
            {
              name: "enabled",
              label: "Enabled",
              type: "boolean",
              default: true,
            },
            {
              name: "bind",
              label: "Bind address",
              type: "string",
              description: "Overrides the default bind for this endpoint.",
            },
            {
              name: "port",
              label: "Port",
              type: "number",
              description: "Overrides the default port for this endpoint.",
            },
            {
              name: "token",
              label: "Token",
              type: "string",
              description:
                "Overrides the default token; empty uses the default.",
            },
            {
              name: "target",
              label: "Single target state",
              type: "string",
              description:
                "Writes the whole request as JSON to one state. Use either this or Targets.",
            },
            {
              name: "targets",
              label: "Targets",
              type: "array",
              item: {
                fields: [
                  {
                    name: "state",
                    label: "State",
                    type: "string",
                    required: true,
                  },
                  { name: "name", label: "Name", type: "string" },
                  {
                    name: "type",
                    label: "Type",
                    type: "select",
                    options: ["number", "string", "boolean"],
                    default: "string",
                    description:
                      "State type when the state has to be created; inferred from the value when absent.",
                  },
                  { name: "role", label: "Role", type: "string" },
                  { name: "unit", label: "Unit", type: "string" },
                  {
                    name: "value",
                    label: "Value expression",
                    type: "string",
                    description:
                      "JS expression over $ (the request); defaults to $.",
                  },
                  {
                    name: "transform",
                    label: "Transform",
                    type: "string",
                    description:
                      "JS expression over value, e.g. (Number(value) - 32) * 5 / 9.",
                  },
                ],
              },
            },
          ],
          exactlyOne: ["target", "targets"],
        },
      },
    ],
    settingsTabs: [
      { id: "settings", label: "Settings", fields: ["bind", "port", "token"] },
      { id: "endpoints", label: "Endpoints", fields: ["endpoints"] },
    ],
  },
];

/** Retired built-ins: valid for an existing config entry (migration
 *  fallback) but never seeded for new installs. */
export const LEGACY_BUILTIN_PLUGINS: readonly BuiltinPluginDef[] = [
  {
    id: "external-access",
    name: "Caddy services",
    timeoutMs: 20_000,
    secured: true,
    help: "Caddy logins and public routes: users are stored as bcrypt hashes, services.json turns http.in webhooks and local proxies into a generated snippet your Caddyfile imports. It never edits the Caddyfile and only reloads Caddy when you press the button.",
    usage: [
      "**What it does**",
      "",
      "- Stores the Caddy Basic-Auth users in `users.json` (bcrypt only) and writes `caddy-users.conf`.",
      "- Stores public services in `services.json` and writes `caddy-services.conf`: token-only `http.in` webhooks and local proxies behind Basic Auth.",
      "- Runs `caddy validate` before `caddy reload`, and only when you press the button.",
      "",
      "**Caddyfile (once)**",
      "",
      "```",
      "home.example.com {",
      "    import /opt/iobroker/iobroker-data/files/ihome.meta/external-access/caddy-services.conf",
      "",
      "    handle {",
      "        basic_auth {",
      "            import /opt/iobroker/iobroker-data/files/ihome.meta/external-access/caddy-users.conf",
      "        }",
      "        reverse_proxy 127.0.0.1:8082",
      "    }",
      "}",
      "```",
      "",
      "The services import must come **before** the catch-all `handle` (Caddy `handle`",
      "blocks are first-match). The card writes `caddy-services.conf`; never edit the",
      "Caddyfile from this plugin. The snippet uses `basic_auth` (Caddy 2.8+); on older",
      "Caddy use `basicauth` in your own Caddyfile.",
      "",
      "**Webhook service**",
      "",
      "Exposes one `http.in` endpoint without Basic Auth, protected only by its token:",
      "`https://…/phone-event?token=…`. The token stays in the `http.in` plugin settings;",
      "rotate it in the card and copy the new link.",
      "",
      "**Proxy service**",
      "",
      "Exposes a local upstream behind the Basic-Auth users, e.g. `/opencode` →",
      "`127.0.0.1:49374`. `strip prefix` turns `/opencode/*` into `/*` for the app.",
      "Only loopback and private upstreams are accepted.",
      "",
      "Never expose ioBroker Admin, the ioBroker socket or Caddy's own admin API as a",
      "service.",
      "",
      "Use `https://…` for external access. `tls internal` instead of a public domain",
      "works for a LAN-only HTTPS setup (the browser warns about the local CA).",
      "",
      "**Install Caddy**",
      "",
      "- Linux: https://caddyserver.com/docs/install#debian-ubuntu-raspbian (apt repo), then `systemctl enable --now caddy`.",
      "- Windows: `winget install CaddyServer.Caddy` or `choco install caddy`; run `caddy run --config C:/caddy/Caddyfile` as a service.",
      "- macOS: `brew install caddy`; `brew services start caddy`.",
      "",
      "**Verify**",
      "",
      "```",
      "caddy validate --config /etc/caddy/Caddyfile",
      "caddy reload  --config /etc/caddy/Caddyfile",
      "curl -I https://home.example.com/ihome/",
      "```",
      "",
      "Router: forward TCP 443 (and 80 for the ACME challenge) to the host running Caddy.",
      "The user list here is only the Basic-Auth list; it does not create ioBroker users.",
    ].join("\n"),
    settingsSchema: [
      {
        name: "dir",
        label: "Data folder",
        type: "string",
        description:
          "Absolute folder for users.json, services.json and the generated snippets, e.g. /opt/iobroker/iobroker-data/files/ihome.meta/external-access",
      },
      {
        name: "caddyConfig",
        label: "Caddyfile",
        type: "string",
        default: "/etc/caddy/Caddyfile",
        description: "Used by the validate and reload commands.",
      },
      {
        name: "reloadCommand",
        label: "Reload command",
        type: "string",
        description:
          "Empty runs: caddy reload --config <Caddyfile>. Set it when Caddy is managed differently.",
      },
      {
        name: "publicUrl",
        label: "Public URL",
        type: "string",
        description:
          "Checked for status only, e.g. https://home.example.com/ihome/",
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

export const MAX_PLUGIN_BUNDLE = 50_000;
const MAX_BUNDLE_CONTROLS = 100;

/** Strict shape for a plugin's declarative device; `undefined` means invalid. */
export function pluginBundleOf(value: unknown): PluginBundle | undefined {
  if (!record(value) || value.version !== 1) return undefined;
  if (JSON.stringify(value).length > MAX_PLUGIN_BUNDLE) return undefined;
  if (!record(value.device)) return undefined;
  const device = value.device;
  if (!Array.isArray(device.controls)) return undefined;
  if (
    device.controls.length < 1 ||
    device.controls.length > MAX_BUNDLE_CONTROLS
  ) {
    return undefined;
  }
  const controls: PluginBundleControl[] = [];
  for (const raw of device.controls) {
    if (!record(raw)) return undefined;
    const state = textOf(raw.state, 200);
    const feature = textOf(raw.feature, 80);
    if (!state || !feature) return undefined;
    const control: PluginBundleControl = { state, feature };
    if (raw.label !== undefined) {
      const label = textOf(raw.label, 80);
      if (!label) return undefined;
      control.label = label;
    }
    if (raw.unit !== undefined) {
      const unit = textOf(raw.unit, 40);
      if (!unit) return undefined;
      control.unit = unit;
    }
    if (raw.role !== undefined) {
      const role = textOf(raw.role, 80);
      if (!role) return undefined;
      control.role = role;
    }
    if (raw.type !== undefined) {
      const type = textOf(raw.type, 40);
      if (!type) return undefined;
      control.type = type;
    }
    if (raw.writable !== undefined) {
      if (typeof raw.writable !== "boolean") return undefined;
      control.writable = raw.writable;
    }
    if (raw.transform !== undefined) {
      if (!record(raw.transform)) return undefined;
      control.transform = raw.transform;
    }
    controls.push(control);
  }
  const result: PluginBundleDevice = { controls };
  if (device.name !== undefined) {
    const name = textOf(device.name, 64);
    if (!name) return undefined;
    result.name = name;
  }
  if (device.type !== undefined) {
    const type = textOf(device.type, 40);
    if (!type) return undefined;
    result.type = type;
  }
  if (device.icon !== undefined) {
    const icon = textOf(device.icon, 200);
    if (!icon) return undefined;
    result.icon = icon;
  }
  if (device.size !== undefined) {
    if (!record(device.size)) return undefined;
    const w = device.size.w;
    const h = device.size.h;
    if (
      typeof w !== "number" ||
      typeof h !== "number" ||
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      w > 20 ||
      h < 1 ||
      h > 10
    ) {
      return undefined;
    }
    result.size = { w, h };
  }
  return { version: 1, device: result };
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
    // A retired built-in keeps validating until the migration turns it into a
    // file plugin; a user entry must not use a shipped built-in id.
    const def = builtin ?? builtinDef(id, LEGACY_BUILTIN_PLUGINS);
    if (!def) return null;
    return {
      id,
      name: def.name,
      enabled: value.enabled !== false,
      builtin: true,
      timeoutMs: timeoutOf(value.timeoutMs),
      debug: value.debug === true,
      ...(typeof value.secured === "boolean" ? { secured: value.secured } : {}),
      ...(def.help ? { help: def.help } : {}),
      ...(def.usage ? { usage: def.usage } : {}),
      ...(def.settingsSchema ? { settingsSchema: def.settingsSchema } : {}),
      ...(def.settingsTabs ? { settingsTabs: def.settingsTabs } : {}),
      ...(settings ? { settings } : {}),
      code: undefined,
    };
  }
  // A shipped builtin id is reserved for its implementation; a retired one
  // becomes an ordinary file plugin after the migration.
  if (builtin && !builtinDef(id, LEGACY_BUILTIN_PLUGINS)) return null;

  // Code may live in `ihome.meta/plugins/<id>/index.js`; the config entry
  // then carries only the runtime flags.
  let code: string | undefined;
  if (value.code !== undefined) {
    if (typeof value.code !== "string" || value.code.trim() === "") return null;
    if (value.code.length > MAX_PLUGIN_CODE) return null;
    code = value.code;
  }
  const help = textOf(value.help, MAX_PLUGIN_HELP);
  const usage = textOf(value.usage, MAX_PLUGIN_USAGE);
  const settingsSchema = pluginSettingsSchema(value.settingsSchema);
  const settingsTabs =
    value.settingsTabs === undefined
      ? undefined
      : settingsSchema
        ? parseSettingsTabs(value.settingsTabs, settingsSchema)
        : undefined;
  if (value.settingsTabs !== undefined && !settingsTabs) return null;
  const bundle =
    value.bundle === undefined ? undefined : pluginBundleOf(value.bundle);
  if (value.bundle !== undefined && !bundle) return null;
  return {
    id,
    name,
    enabled: value.enabled !== false,
    builtin: false,
    timeoutMs: timeoutOf(value.timeoutMs),
    debug: value.debug === true,
    ...(typeof value.secured === "boolean" ? { secured: value.secured } : {}),
    ...(help ? { help } : {}),
    ...(usage ? { usage } : {}),
    ...(settings ? { settings } : {}),
    ...(settingsSchema ? { settingsSchema } : {}),
    ...(settingsTabs ? { settingsTabs } : {}),
    ...(bundle ? { bundle } : {}),
    ...(code ? { code } : {}),
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
      timeoutMs: builtin.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
      debug: false,
      ...(builtin.help ? { help: builtin.help } : {}),
      ...(builtin.usage ? { usage: builtin.usage } : {}),
      ...(builtin.secured ? { secured: true } : {}),
      ...(builtin.settingsSchema
        ? { settingsSchema: builtin.settingsSchema }
        : {}),
      ...(builtin.settingsTabs ? { settingsTabs: builtin.settingsTabs } : {}),
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
  // A built-in's secured default applies once; an explicit false from the
  // Plugins page stays in the raw entry and is never overwritten.
  const upgraded = current.map((value) => {
    if (!record(value)) return value;
    const def = builtins.find((builtin) => builtin.id === value.id);
    if (!def?.secured || value.secured !== undefined) return value;
    return { ...value, secured: true };
  });
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
      timeoutMs: builtin.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
      debug: false,
      ...(builtin.secured ? { secured: true } : {}),
      code: undefined,
    }));
  return [...upgraded, ...missing];
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
