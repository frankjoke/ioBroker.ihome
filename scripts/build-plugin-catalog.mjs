// Turns the compiled external-access built-in into a portable plugin file that
// the catalog ships. The compiled module exports a factory map; the wrapper
// exports the single factory the plugin host expects from a user plugin.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = readFileSync("build/plugins/external-access.js", "utf8");
const code = `${source}\nmodule.exports = module.exports.createExternalAccessPlugins()["external-access"];\n`;
const { LEGACY_BUILTIN_PLUGINS } = require("../build/plugin-ops.js");
const def = LEGACY_BUILTIN_PLUGINS.find((p) => p.id === "external-access");
if (!def) throw new Error("external-access definition missing");
const mod = require("../build/plugins/external-access.js");
const contributions = mod.EXTERNAL_ACCESS_CONTRIBUTIONS;
if (!contributions) throw new Error("external-access contributions missing");
const plugin = {
  id: def.id,
  name: def.name,
  api: 1,
  version: "1.3.0",
  timeoutMs: def.timeoutMs ?? 20000,
  ...(def.secured ? { secured: true } : {}),
  ...(def.help ? { help: def.help } : {}),
  ...(def.usage ? { usage: def.usage } : {}),
  ...(def.settingsSchema ? { settingsSchema: def.settingsSchema } : {}),
  ...(def.settingsTabs ? { settingsTabs: def.settingsTabs } : {}),
  contributions,
  code,
};
const file = `${JSON.stringify({ format: "ihome-plugin", version: 1, plugin }, null, 2)}\n`;
mkdirSync("build/plugin-catalog", { recursive: true });
writeFileSync("build/plugin-catalog/external-access.json", file);
mkdirSync("static/plugins", { recursive: true });
writeFileSync("static/plugins/external-access.json", file);
console.log("external-access catalog:", code.length, "bytes");

// pvforecast ships the same way: compiled factory + manifest metadata.
const pvSource = readFileSync("build/plugins/pvforecast.js", "utf8");
const pvCode = `${pvSource}\nmodule.exports = module.exports.createPvForecastPlugin();\n`;
const pv = require("../build/plugins/pvforecast.js");
const pvPlugin = {
  id: "pvforecast",
  name: "PV forecast",
  api: 1,
  version: "1.0.1",
  timeoutMs: 30000,
  help: pv.PVFORECAST_HELP,
  usage: pv.PVFORECAST_USAGE,
  settingsSchema: pv.PVFORECAST_SETTINGS_SCHEMA,
  settings: pv.PVFORECAST_DEFAULT_SETTINGS,
  contributions: pv.PVFORECAST_CONTRIBUTIONS,
  code: pvCode,
};
const pvFile = `${JSON.stringify({ format: "ihome-plugin", version: 1, plugin: pvPlugin }, null, 2)}\n`;
writeFileSync("static/plugins/pvforecast.json", pvFile);
console.log("pvforecast catalog:", pvCode.length, "bytes");
