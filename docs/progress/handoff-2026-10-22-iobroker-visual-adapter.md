# Handoff — 2026-10-22 — iHome as a real ioBroker adapter (0.0.1 → 0.0.10)

## Where things are

| | |
|---|---|
| **Checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch **`main`**, clean, head `7a313a0`, **in sync with `origin/main`**. Single branch, no tags. |
| **Remote** | `origin` = `https://github.com/frankjoke/ioBroker.ihome` (public). Push works (Git Credential Manager). `gh` is not installed. |
| **Live broker** | `192.168.178.9` — js-controller **7.2.5**, Node 24.19.0, host `iobroker`. Adapter object **0.0.9**, but the SPA files served are the **0.0.10** build (deployed live, see below). |
| **Adapter data** | `ihome.0.config.pageList` (3 pages, 26 tiles), `.deviceList` (12 devices), `.formulaList`, `.templateList` (empty). Instance root is empty. Originals untouched in `0_userdata.0.Test.AiHome.*` (backup). |
| **Dashboard** | `http://192.168.178.9:8082/ihome/index.html`; link card on the admin Schnellzugriff + web start page (`localLinks`). |
| **Dev server** | user's on `:5173`; dev broker comes from `.env.development.local` (gitignored). Watcher now uses polling (OneDrive). |
| **Gates at handoff** | `npm test` 391/391 (33 files) · `npm run check` 0 · `npm run lint` 0 · `npm run build` green · `test:package` 46/46 (run `npm test` for all three). |

## What landed

**The adapter itself (0.0.1)** — `main.js` runs `mode: "once"`: creates `ihome.0.config.<doc>` as JSON states, copies values in from `0_userdata.0.Test.AiHome.*` or the old root states, deletes the root state afterwards (never when `config.*` stayed empty), exits. No config dialog (`adminUI.config: "none"`), no admin tab, `singleton: true`, `localLinks` → `%web_protocol%://%ip%:%web_port%/ihome/index.html`, icon `adapter/ihome/ihome.png`. `www/` is **committed** (GitHub installs don't build). Package: CJS `main.js` (dropped `"type": "module"`, moved the SvelteKit config into `vite.config.mjs`), `files` = admin/www/io-package/main/LICENSE/README, tests (`test/package.js`, `test/integration.js` via `@iobroker/testing`), CI workflow, `.releaseconfig.json`, README rewritten.

**SPA host integration (0.0.2)** — socket URL from the page host on **8081** (`VITE_SOCKET_URL` for dev, `?socket=` override), stores point at `ihome.0.config.*`, `DEFAULT_NAMESPACE = "ihome.0"`, legacy persisted namespaces (`iHome`, `admin.0`, `0_userdata.0.Test.AiHome`) fall back to it.

**Device editor (0.0.4)** — each state row has a pencil → the picker opens as "Change state" (single pick, "Use state"); `src/lib/config/control-ops.ts` takes the new stateId/feature/writable and keeps hand-written label/unit plus transform/history/rules. Long state ids elide their **middle** instead of their end (`bambulab.0.0309…BedTemp`).

**Edit-mode bar (0.0.5 → 0.0.9)** — the top bar is tinted while the layout sheet is open: `--edit-mode-bar` in `app.css` (light `#f6d3d3`, dark `#5f2b2d`). Deliberately a **plain colour**: `color-mix()` is dropped silently by older Safari/Chrome and tablet webviews (that was why it stayed untinted in the user's browser while my dev Chromium showed it).

**Staleness chain (0.0.6, 0.0.7, 0.0.10 + web adapter)** — four independent causes, all closed:
1. the SPA's service worker precached the shell → 0.0.6: shell is network-first (`ihome-shell` cache only as offline fallback), `skipWaiting` + `clientsClaim`;
2. SvelteKit registered the worker with `updateViaCache: "imports"` → the web adapter's `max-age=6000` delayed the update check ~100 min → 0.0.7: registered in `+layout.svelte` with `updateViaCache: "none"`;
3. a SW `fetch` uses the HTTP cache → 0.0.10: the navigation fetch uses `cache: "no-cache"` (revalidate, 304 while unchanged);
4. the **web adapter itself** served everything with `max-age=6000` → user installed **web 9.1.16** (from git); it now sends `Cache-Control: no-cache` + ETag for the shell and all our files. Verified by header probe.
   *Note: on the plain-HTTP LAN origin there is **no service worker at all** (`navigator.serviceWorker === undefined` — not a secure context); 1–3 only matter for `localhost` (dev) and any https/reverse-proxy install.*

**The pencil bug (0.0.7)** — the pencil is `<a href="/ihome/#/">` while the dashboard is served at `/ihome/index.html`: a different document, so the click did a **real reload**, dropping the sheet it had just opened (the "empty page"). The plain click is swallowed now (`preventDefault`).

**Tooling** — `npm run pack` (build + `iobroker.ihome-<version>.tgz` in the repo root, gitignored) · **`npm run deploy:www`** (`scripts/deploy-www.mjs`: writes the whole built `www/` into the broker's file namespace `ihome/` through the MCP endpoint, deletes chunks the build no longer has — UI-only live deploys, no install) · dev-server `watch.usePolling` (OneDrive).

## Live evidence

- **Migration** ran: `Copied pageList/deviceList/formulaList …` and `Removed the old root state …`; `ihome.0` root empty, `config.*` filled.
- **Served SPA is 0.0.10**: served `_app/version.json` equals the local build; markers (`edit-mode-bar`, `sid-tail`, `updateViaCache`, `no-cache`) present; in a browser (cache-busted URL) the pencil keeps the hash and opens the sheet, the bar reads `rgb(246,211,211)`.
- **Live deploy** verified through `deploy:www` (11 files, correct content types, `version.json` parity).
- **MCP**: endpoint `http://192.168.178.9:8082/mcp/` (adapter `mcp` **1.2.1**, served through the web adapter). Sessions verified by hand: `initialize` → `mcp-session-id` → `tools/list` (28 tools) → `tools/call` (`system_info`, `list_files ihome`).

## Incidents to know about (data)

- The SPA **seeds an empty `pageList` when it cannot read one** and (until 0.0.4) **saved it** — that overwrote the migrated documents twice. I restored them by hand (socket write; legacy states intact). 0.0.4 stopped the auto-save, and the adapter's migration now treats a **tile-less seed** as empty, so the real document still comes across.
- My first `deploy:www` run had a path bug (absolute paths) and **emptied the `ihome` file namespace**; the web adapter kept serving from its cache, so nothing looked broken. Fixed the script and restored all 11 files through it (verified).

## Gotchas

- **OneDrive watcher** (dev): Vite misses file events; polling is on now, but if a change doesn't show, restart `npm run dev` first.
- **After an adapter update** the `mode: "once"` instance does **not** restart itself — the migration only runs when you start `ihome.0` once (Instances → play).
- **Don't open the dashboard before the adapter's first run** on a fresh install (the seed issue above).
- **OpenCode's remote MCP client** keeps a session id and never re-initializes after a 400 (issues #38891/#32809/#25137) — every ioBroker-side restart (`web`, `mcp`) breaks it until `/mcps` → disconnect/connect. Verified workaround: bridge as a local server — `["npx","-y","mcp-remote","http://192.168.178.9:8082/mcp/","--allow-http"]` (the flag is required for plain HTTP; the bridge listed all 28 tools). `deploy:www` is unaffected (it opens its own session).
- **Hashed assets get `no-cache`** instead of a year (the web adapter's rule matches dash-separated hashes; SvelteKit writes `style.<hash>.css`). Cosmetic.
- The admin's Schnellzugriff (Intro) card and the icon live in `common.localLinks`; icons are `adapter/<adapter>/<file>` because admin prefixes plain names.

## Open items

1. Install `iobroker.ihome-0.0.10.tgz` (repo root) to sync the adapter object 0.0.9 → 0.0.10 (`main.js` is identical; only metadata). Optional.
2. Optional hardening: move the `iobroker` MCP entry to V2 shape (`mcp.servers`) and use the `mcp-remote` bridge so restarts stop breaking it.
3. CI workflow is committed but its **first run is unverified** — check the repo's Actions tab.
4. **The adapter-logic stream** — the actual next feature work (what the adapter should do beyond owning the documents); also the natural home for fixing the SPA's seed-on-unreadable-document behaviour.
5. Release stream (later): `release-script`, npm publish, PR to `ioBroker/ioBroker.repositories`; the deploy job was deliberately left out of the workflow.

## Cheat-sheet

```bash
npm run dev                 # :5173 against the dev broker (.env.development.local)
npm test                    # vitest + package + integration
npm run pack                # build + iobroker.ihome-<version>.tgz (repo root)
IOBROKER_MCP=http://192.168.178.9:8082/mcp/ npm run deploy:www   # live UI deploy
# install: Admin → Adapters → install dialog → pick the .tgz (uploads + uploads www)
# then: Instances → ihome.0 → start (runs the migration once, then exits)
```
