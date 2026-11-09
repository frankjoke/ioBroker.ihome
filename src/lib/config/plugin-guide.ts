/** Static help for writing, installing and debugging an iHome plugin. */
export const PLUGIN_GUIDE = `## What a plugin is

A plugin is trusted Node code that the adapter loads at start. It gets the iHome plugin API and a timeout, and may implement start, call, reload and stop. **Only import plugins you trust.**

## File format

One plugin per JSON file. Import stages it disabled.

\`\`\`json
{
  "format": "ihome-plugin",
  "version": 1,
  "plugin": {
    "id": "demo.echo",
    "name": "Demo echo",
    "timeoutMs": 5000,
    "help": "Returns its payload.",
    "usage": "Payload: any JSON. Result: { echo, prefix }.",
    "settingsSchema": [
      { "name": "prefix", "label": "Prefix", "type": "string", "default": "echo" }
    ],
    "settings": { "prefix": "hello" },
    "code": "module.exports = (api) => ({ async call(payload) { return { echo: payload, prefix: api.settings.prefix }; } });"
  }
}
\`\`\`

## Module

\`\`\`js
module.exports = (api) => {
  let prefix = api.settings.prefix ?? "echo";
  return {
    async start() { api.log.info("ready"); },
    async call(payload) {
      api.log.debug("echo " + JSON.stringify(payload));
      return { echo: payload, prefix };
    },
    async reload(api) { prefix = api.settings.prefix ?? prefix; },
    async stop() { api.log.info("stopped"); },
  };
};
\`\`\`

## API

- \`namespace\` — this adapter instance, e.g. \`ihome.0\`.
- \`config\` — read-only native config; secrets are removed.
- \`settings\` — live non-secret settings; a fresh object per read.
- \`log\` — \`debug\`, \`info\`, \`warn\`, \`error\`. Debug is off until the plugin's Debug switch is on.
- \`state.get\` / \`state.set\` / \`state.getForeign\` / \`state.setForeign\`.
- \`objects.get\` / \`objects.getForeign\`.
- \`network.list\` / \`network.get\` — the adapter's configured network devices.
- \`sendTo(instance, command, payload)\`.

## Install and run

1. Import the JSON file; it is staged **disabled**.
2. Restart the adapter from ioBroker Admin (adding code requires a restart).
3. Enable the plugin on this page. It starts from the code the adapter loaded.
4. Call it from a logic with \`call("demo.echo", payload, (data, error) => { ... })\` or from HTML with \`await ihome.call("demo.echo", payload)\`.

Settings changes apply live when the plugin implements \`reload\`; otherwise the page marks a restart required. Code changes always need the Admin edit and restart.

Use **Export** in the plugin editor to download a user plugin as the same JSON file. Built-ins cannot be exported because their code lives in the adapter.

## Debug logs

Turn on **Debug logs** for one plugin; its \`api.log.debug\` lines appear in the ioBroker log with the prefix \`plugin <id>:\`. The adapter's log level must allow debug.

## Secrets

Settings are stored in ioBroker and visible to anyone with broker read access. Passwords and tokens belong in the adapter's native config, not in plugin settings.`;
