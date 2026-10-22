---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
# External Integrations

**Analysis Date:** 2026-10-22

## APIs & External Services

**ioBroker broker (socket):**
- The SPA is a pure client of the ioBroker WebSocket API — the single most important integration.
- SDK/Client: `@iobroker/ws` 3.1.3 (devDependency, bundled into `www/`; raw `WebSocket`, not the npm `socket.io-client`) — the published upstream of the copy that used to be vendored at `src/lib/iobroker.socket.io.js`; wrapped by `src/lib/ioBrokerConnect.svelte.js`.
- Endpoint resolution: `src/lib/socket-url.ts` — `VITE_SOCKET_URL` → `?socket=` query param → the configured fallback (`FALLBACK_BROKER` in `src/lib/broker-config.ts`, empty by default) → `ws(s)://<page-host>:8081/socket.io`. The layout can override with the persisted `Host:Port` (`__VISUAL__:hostPort` in localStorage, `src/routes/+layout.svelte`).
- Handshake: connects with `?sid=<timestamp>` and emits `name` with the namespace (`DEFAULT_NAMESPACE = "ihome.0"`); optional `token`/`name` query params are supported by the client but not set by the app.
- RPC calls used (`src/lib/ioBrokerConnect.svelte.js`):
  - `getAllObjects` — full object cache at connect
  - `getState`, `getObject` — per-id reads, cached in `StateClass` maps
  - `setState` — control writes, stamped `from: "system.adapter.ihome.0"`
  - `setObject` — creating the `config.*` JSON state objects when missing (`src/lib/stores/pages.svelte.ts`, `templates.svelte.ts`, `formulas.svelte.ts`, `registry.svelte.js`)
  - `getHistory` — chart series (`src/lib/stores/history.svelte.ts`, `src/lib/config/history-ops.ts`)
  - `sendTo` — generic adapter messaging (`ioBroker.sendTo`), currently unused by features
  - `subscribe "*"` and `subscribeObjects "*"` — live updates for all states/objects
- Inbound socket events handled: `stateChange`, `objectChange`, `connect`, `reconnect`, `disconnect`, `connect_error`, `error`, `permissionError`, `reauthenticate`, `message`.
- Connection timeouts: 10 s connect, 15 s `emitAsync` RPC, 30 s `sendTo`.

**ioBroker history adapter (charts):**
- `getHistory(stateId, { start, end, ignoreNull, count | step + aggregate })` in `src/lib/config/history-ops.ts`.
- Requires any ioBroker history provider (e.g. `history.0`, `influxdb`, `sql`) to have the state logged; `historyEnabled()` checks `common.custom[*].enabled !== false`.
- Supported aggregates: `average`, `min`, `max`, `total`, `count`, `none`, `onchange`; duration in hours/days, step in seconds/minutes/hours (`src/lib/types/device.ts`).
- Charts are rendered locally as SVG (`src/lib/components/display/TileChart.svelte`) — no charting library or external service.

**Google Fonts CDN:**
- `src/app.html` loads Plus Jakarta Sans, JetBrains Mono, and Material Symbols Outlined from `fonts.googleapis.com` / `fonts.gstatic.com`.
- This is a runtime internet dependency: a fully offline LAN/PWA install will fall back to system fonts and Material Symbols glyphs will not render unless cached.
- The icon-name list itself is local: `src/lib/assets/material-symbol-names.json`.

**Embedded third-party pages (frames):**
- `src/lib/components/display/slots/FrameSlot.svelte` renders an `<iframe>` to any configured URL — typically ioBroker `web`-adapter pages such as eCharts or Energiefluss (`http://…/echarts/index.html?preset=…`).
- Deliberately no `sandbox` attribute (pages need their own scripts/storage); `options.inert` disables pointer events only.
- URL is user-supplied per slot in the layout editor (`src/lib/components/layout/SlotPicker.svelte`, `LayoutDetails.svelte`).

**ioBroker MCP endpoint (deployment only):**
- `scripts/deploy-www.mjs` speaks JSON-RPC 2.0 over HTTP with SSE-style responses to `IOBROKER_MCP` (default `http://localhost:8082/mcp/`).
- Flow: `initialize` → capture `mcp-session-id` → `tools/call` for `list_files`, `mkdir`, `write_file` (base64 for binary), `delete_file`.
- Writes into the broker's file namespace `ihome/` (third CLI arg, default `ihome`), which the `web` adapter serves at `/ihome/`.

## Data Storage

**Databases:**
- No database driver or ORM in this project. Persistence is ioBroker's own state store (js-controller-managed; backend depends on the broker installation).
- The adapter owns four JSON states, created in `main.js` and edited by the SPA over the socket:

| State | Contents | Written by |
|-------|----------|-----------|
| `ihome.0.config.pageList` | pages, groups, tiles/layout | `src/lib/stores/pages.svelte.ts` |
| `ihome.0.config.deviceList` | device registry | `src/lib/stores/devices.svelte.ts` / `src/lib/registry.svelte.js` |
| `ihome.0.config.templateList` | tile templates | `src/lib/stores/templates.svelte.ts` |
| `ihome.0.config.formulaList` | formula definitions | `src/lib/stores/formulas.svelte.ts` / `src/lib/formulas.svelte.js` |

- One-time migration in `main.js`: copies from legacy `0_userdata.0.Test.AiHome.<doc>` (foreign state, never modified), else from old root states (`ihome.0.<doc>`), then deletes the root state if `config.*` is populated. A tile-less "seeded" page document counts as empty (`isPlaceholder`).

**File Storage:**
- Built SPA files only: `www/` in the package, uploaded to the broker's file storage under namespace `ihome/` for live deploys.
- Adapter icon: `admin/ihome.png`, referenced as `adapter/ihome/ihome.png` from `io-package.json`.

**Caching:**
- Browser localStorage via `createReactiveStorage` (`src/lib/localStorage.js`):
  - `__VISUAL__:theme`, `__VISUAL__:hostPort`, `__VISUAL__:namespace` (`src/routes/+layout.svelte`, `src/lib/theme.svelte.js`)
  - `iHome.view` — last selected page view (`src/lib/stores/pages.svelte.ts`)
  - sessionStorage supported by the helper but unused.
- Cache Storage bucket `ihome-shell` — network-first navigation fallback in `src/service-worker.js`; hashed assets precached with Workbox.
- In-memory caches: `StateClass` maps (`src/lib/StateClass.svelte.js`), history cache (`src/lib/stores/history.svelte.ts`).

## Authentication & Identity

**Auth Provider:**
- None in the app. Authentication and permissions are enforced by ioBroker (the WebSocket handshake carries the broker's session; `permissionError` events are logged in `src/lib/ioBrokerConnect.svelte.js`).
- The SPA writes as `system.adapter.ihome.0` (`setState` in `src/lib/ioBrokerConnect.svelte.js`), so the broker's ACL for that namespace applies.
- No login screen, OAuth, JWT, or token storage. The adopted `@iobroker/ws` client supports a `token` query parameter, unused here.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, analytics, or telemetry). Errors surface via `console.error` / `console.warn` in `src/lib/ioBrokerConnect.svelte.js`, `src/lib/StateClass.svelte.js`, and stores.

**Logs:**
- Adapter side: `this.log.info/warn` from `@iobroker/adapter-core` in `main.js` (migration messages).
- UI side: browser console only.

## CI/CD & Deployment

**Hosting:**
- Self-hosted ioBroker broker; the `web` adapter serves the static SPA at `/ihome/index.html` (link registered in `io-package.json` `localLinks`).

**CI Pipeline:**
- `.github/workflows/test-and-release.yml` — on every push/PR and version tags, runs `ioBroker/testing-action-check@v2` (Node 24, lint) then `ioBroker/testing-action-adapter@v1` (Node 22 and 24, with build). No npm publish job yet.
- Release: `@alcalzone/release-script` with `iobroker`, `license`, `manual-review` plugins (`.releaseconfig.json`).
- Packaging: `npm run pack` → `iobroker.ihome-<version>.tgz` (gitignored) for manual install.
- UI-only deploy: `npm run deploy:www` via the ioBroker MCP endpoint (see above).

**Cache behavior (deployment-sensitive):**
- `www/_app` assets are hashed; `src/routes/+layout.svelte` registers the service worker with `updateViaCache: "none"`, and `src/service-worker.js` fetches navigations with `cache: "no-cache"` because the `web` adapter sends its own `Cache-Control`. Do not reintroduce a precached shell.

## Environment Configuration

**Required env vars:**
- Runtime/build: `VITE_SOCKET_URL` (optional; dev broker socket).
- Deploy script: `IOBROKER_MCP` (optional; defaults to `http://localhost:8082/mcp/`).
- No secrets are required by the adapter or SPA.

**Secrets location:**
- None committed. `.env.development.local` exists locally and is gitignored along with `.env` / `.env.*` (`.gitignore`). Never commit its contents.

## Webhooks & Callbacks

**Incoming:**
- None (HTTP webhooks). All inbound traffic is the ioBroker WebSocket event stream.

**Outgoing:**
- None (no webhook/HTTP callbacks). Outbound requests are limited to the ioBroker socket, the Google Fonts CDN (browser), embedded iframe URLs (browser), and the MCP endpoint in the deploy script.

---

*Integration audit: 2026-10-22*
