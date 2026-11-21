import type { ImportedPlugin } from "$adapter/plugin-file";
import nutCode from "../../../examples/nut-ups.js?raw";

/** Ready-to-import user plugins shown in the import dialog. */
export const NUT_EXAMPLE: ImportedPlugin = {
  id: "nut.ups",
  name: "NUT UPS",
  timeoutMs: 8000,
  help: "Read-only monitor for one Network UPS Tools (NUT) UPS. Polls its variables and writes them to iHome states.",
  usage: [
    "**Settings**",
    "",
    "```ts",
    '{ host: "localhost", port: 3493, ups: "piups", base: "plugins.nut.ups", interval: 30 }',
    "```",
    "",
    "Writes one state per NUT variable under the `base` folder. A relative",
    "`base` (default `plugins.nut.ups`) writes to",
    "`ihome.0.plugins.nut.ups.*`; an absolute value such as",
    "`0_userdata.0.nut` writes there instead. States include",
    "`ups.status`, `battery.charge`, `output.voltage` plus `connected`,",
    "`online`, `onBattery`, `lowBattery`, `charging`, `discharging`, `error`",
    "and `lastUpdate`.",
    "",
    "**From a logic**",
    "",
    "```js",
    'call("nut.ups", { refresh: true }, (data, error) => {',
    '  if (error) return log(error, "warn");',
    '  log(data.status + " · " + data.batteryCharge + "%");',
    "});",
    "```",
    "",
    "Read-only: the example uses no credentials. The NUT server must allow",
    "`LIST VAR` (normal on the LAN). Beeper and load commands are not included.",
    "",
    "After enabling, apply the **NUT UPS** tile from Templates → Templates (or",
    "the tile picker). Its default sources use the `ihome.0.plugins.nut.ups`",
    "base; edit the slot sources if your instance or `base` setting differs.",
  ].join("\n"),
  settingsSchema: [
    {
      name: "host",
      label: "NUT host",
      type: "string",
      default: "localhost",
      description: "Host running upsd (the NUT server).",
    },
    {
      name: "port",
      label: "Port",
      type: "number",
      default: 3493,
      description: "NUT server port; default 3493.",
    },
    {
      name: "ups",
      label: "UPS name",
      type: "string",
      default: "ups",
      description: "UPS name from ups.conf, e.g. piups.",
    },
    {
      name: "base",
      label: "State folder",
      type: "string",
      default: "plugins.nut.ups",
      description:
        "Relative to iHome (plugins.nut.ups → ihome.0.plugins.nut.ups) or an absolute folder such as 0_userdata.0.nut.",
    },
    {
      name: "interval",
      label: "Poll interval (s)",
      type: "number",
      default: 30,
      description: "Seconds between polls; minimum 5.",
    },
  ],
  settings: {
    host: "localhost",
    port: 3493,
    ups: "ups",
    base: "plugins.nut.ups",
    interval: 30,
  },
  contributions: {
    tiles: [
      {
        id: "nut-ups",
        name: "NUT UPS",
        description:
          "Battery, runtime, load and status of a Network UPS Tools UPS.",
        help: `Apply this tile after enabling the plugin. The default sources use the \`ihome.0.plugins.nut.ups\` base; edit the slot sources if your instance or \`base\` setting differs.`,
        type: "Custom",
        bindings: "none",
        size: { w: 4, h: 2 },
        features: [],
        slots: [
          {
            kind: "value",
            label: "Battery",
            unit: "%",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.battery.charge",
            },
            icon: { glyph: "battery_charging_full" },
          },
          {
            kind: "value",
            label: "Runtime",
            unit: "min",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.battery.runtime",
            },
          },
          {
            kind: "value",
            label: "Load",
            unit: "%",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.ups.load",
            },
          },
          {
            kind: "value",
            label: "Status",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.ups.status",
            },
          },
          {
            kind: "value",
            label: "Output voltage",
            unit: "V",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.output.voltage",
            },
          },
          {
            kind: "value",
            label: "Model",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.device.model",
            },
          },
          {
            kind: "badge",
            label: "Connected",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.connected",
            },
          },
          {
            kind: "badge",
            label: "On battery",
            source: {
              kind: "state",
              stateId: "ihome.0.plugins.nut.ups.onBattery",
            },
          },
        ],
      },
    ],
  },
  code: nutCode,
};
