# ioBroker.ihome

iHome is a dashboard adapter for ioBroker: a Svelte single-page app (installable as a PWA) for
monitoring and controlling your smart home, with pages, devices, templates and formulas.

The adapter itself is minimal — it owns the dashboard's JSON documents and exits. The UI is served
by the `web` adapter and talks to ioBroker over socket.io.

## Installation

Install from GitHub through the admin UI:

1. ioBroker Admin → **Adapters** → **Install from custom URL**
2. Enter `https://github.com/frankjoke/ioBroker.ihome`
3. Create an instance of `ihome` (there is no configuration dialog)

Then open:

- the **iHome dashboard** link on the admin/web start page, or
- `http://<ioBroker-host>:8082/ihome/index.html`

## Data

The dashboard stores its documents in the adapter's own namespace, as JSON states:

| State | Content |
|-------|---------|
| `ihome.0.config.pageList` | pages and tile layout |
| `ihome.0.config.deviceList` | known devices |
| `ihome.0.config.templateList` | tile templates |
| `ihome.0.config.formulaList` | formula definitions |

On first start the adapter fills an empty `ihome.0.config.*` from the old test namespace
`0_userdata.0.Test.AiHome.*` (and from the early `ihome.0.*` root states, which are removed
afterwards). The old test states are left untouched.

The UI connects to socket.io on port `8081` of the host that served the page. For reverse-proxy or
non-standard setups, open the dashboard as `…/ihome/index.html?socket=wss://host/path/socket.io`.

## Push notifications

Push reaches an installed PWA even when it is closed. It needs HTTPS (the iobroker.pro page or a
local HTTPS proxy); on iOS 16.4+ the PWA must be added to the home screen.

1. Open iHome over HTTPS → **Server & Security** → **This phone** → **Enable notifications**.
   The adapter generates the VAPID pair on first start and stores the private key encrypted; no
   manual key setup is needed.
2. Send a test from the card, from a script, or from a logic:

```js
sendTo("ihome.0", "notify", { title: "Alarm", body: "Pump pressure low", level: "error" });
notify("Alarm", "Pump pressure low", "error"); // inside a logic
```

The lock-screen text is generic by default; add `showBody: true` to the `sendTo` payload to show the
full title and body. To rotate the VAPID keys later, use the instance config dialog
(**Push notifications**) or generate a pair with `npm run vapid`.

## Logic fetchJson

Inside a logic, `fetchJson` fetches JSON without blocking the event. The
callback runs later in the same logic, one request at a time:

```js
fetchJson("https://api.example/price", (data, error) => {
  if (error) return;
  set("0_userdata.0.Price", data.value);
});
```

`set("$self", value)` writes the logic's own output. Requests time out after
10 s; a logic waits on at most 10 requests. An optional third argument accepts
`{ method, headers, body }`.

## Development

```bash
npm install
npm run dev      # dev server on :5173, against the broker in .env.development.local
npm run build    # writes the SPA to www/ (committed — it is what GitHub installs ship)
npm test         # vitest + package + integration tests
npm run check    # svelte-check
npm run lint     # eslint
```

For a quick UI-only deploy into a running broker (no adapter install; the files
land in its file storage and the web adapter serves them):

```bash
IOBROKER_MCP=http://<broker>:8082/mcp/ npm run deploy:www
```

`www/` is tracked on purpose: ioBroker installs from GitHub without building the frontend, so run
`npm run build` before committing UI changes.

## License

MIT
