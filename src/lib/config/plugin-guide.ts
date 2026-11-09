/** Static help for writing, installing and debugging an iHome plugin. */
export const PLUGIN_GUIDE = `## What a plugin is

A plugin adds a function to iHome. It runs inside the iHome adapter alongside ioBroker, so **only import plugins you trust**. The adapter loads plugins when it starts.

The rest of this guide is for people who write or update a plugin. To install one, use Import and follow the steps below.

## File format

One plugin per file. Import keeps the plugin switched off until the next restart.

\`\`\`json
{
  "format": "ihome-plugin",
  "version": 1,
  "plugin": {
    "id": "demo.echo",
    "name": "Demo echo",
    "timeoutMs": 5000,
    "help": "Returns its options.",
    "usage": "Options: any JSON. Result: { echo, prefix }.",
    "settingsSchema": [
      { "name": "prefix", "label": "Prefix", "type": "string", "default": "echo" }
    ],
    "settings": { "prefix": "hello" },
    "code": "module.exports = (api) => ({ async call(options) { return { echo: options, prefix: api.settings.prefix }; } });"
  }
}
\`\`\`

## Module

\`\`\`js
module.exports = (api) => {
  let prefix = api.settings.prefix ?? "echo";
  return {
    async start() { api.log.info("ready"); },
    async call(options) {
      api.log.debug("echo " + JSON.stringify(options));
      return { echo: options, prefix };
    },
    async reload(api) { prefix = api.settings.prefix ?? prefix; },
    async stop() { api.log.info("stopped"); },
  };
};
\`\`\`

## API

- \`id\` — this plugin's id, e.g. \`nut.ups\`.
- \`namespace\` — this adapter instance, e.g. \`ihome.0\`.
- \`config\` — read-only native config; secrets are removed.
- \`settings\` — live non-secret settings; a fresh object per read.
- \`log\` — \`debug\`, \`info\`, \`warn\`, \`error\`. Debug is off until the plugin's Debug switch is on.
- \`state.get\` / \`state.set\` / \`state.getForeign\` / \`state.setForeign\`.
- \`objects.get\` / \`objects.getForeign\`.
- \`network.list\` / \`network.get\` — the adapter's configured network devices.
- \`sendTo(instance, command, payload)\`.

## State folder

A plugin that creates its own states puts them under \`plugins.<plugin-id>\` in
the iHome namespace — for example \`ihome.0.plugins.nut.ups.*\`. Use
\`api.id\` to build that prefix. Offer a configurable base folder if users may
want the data elsewhere. \`http.in\` is the exception: it writes exactly the
\`target\` or \`targets\` you configure.

## Device template

A plugin file may carry a \`bundle.device\` preset. When the plugin is enabled,
the UI creates that device from the preset; if a generated device already
exists and the template changed, it asks before updating. Control \`state\`
paths are relative to \`plugins.<plugin-id>\` or the plugin's \`base\` setting.
The device is tagged with \`plugin:<id>\` and the bundle hash; disabling or
removing the plugin leaves it in place.

## Install and run

The Import dialog has a **NUT example** button — a read-only Network UPS Tools
monitor you can load, inspect and adapt.

1. Import the plugin file; it stays switched off.
2. Restart iHome in ioBroker Admin. New or changed plugin code needs a restart.
3. Enable the plugin on this page.
4. Call it from a logic with \`call("demo.echo", options, (data, error) => { ... })\` or from HTML with \`await ihome.call("demo.echo", options)\`.

Settings changes take effect immediately when the plugin supports it; otherwise the page asks for a restart. Code changes always need the Admin edit and restart.

Use **Export** in the plugin editor to download a user plugin as the same JSON file. Built-ins export their settings only; their code lives in the adapter.

## Debug logs

Turn on **Debug logs** for one plugin; its \`api.log.debug\` lines appear in the ioBroker log with the prefix \`plugin <id>:\`. The adapter's log level must allow debug.

## Secrets

Settings are not secret: anyone who can read your ioBroker objects can see them. Keep passwords and tokens in the adapter settings, not in plugin settings.`;
