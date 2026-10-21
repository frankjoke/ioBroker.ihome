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
| `ihome.0.pageList` | pages and tile layout |
| `ihome.0.deviceList` | known devices |
| `ihome.0.templateList` | tile templates |
| `ihome.0.formulaList` | formula definitions |

On first start the adapter copies existing values from the old test namespace
`0_userdata.0.Test.AiHome.*` into these states (once, and only when the new state is empty).
The old states are left untouched.

The UI connects to socket.io on port `8081` of the host that served the page. For reverse-proxy or
non-standard setups, open the dashboard as `…/ihome/index.html?socket=wss://host/path/socket.io`.

## Development

```bash
npm install
npm run dev      # dev server on :5173, against the broker in .env.development.local
npm run build    # writes the SPA to www/ (committed — it is what GitHub installs ship)
npm test         # vitest + package + integration tests
npm run check    # svelte-check
npm run lint     # eslint
```

`www/` is tracked on purpose: ioBroker installs from GitHub without building the frontend, so run
`npm run build` before committing UI changes.

## License

MIT
