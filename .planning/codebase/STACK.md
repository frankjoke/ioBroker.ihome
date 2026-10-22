---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
# Technology Stack

**Analysis Date:** 2026-10-22

## Languages

**Primary:**
- JavaScript (CommonJS) — ioBroker adapter process: `main.js`
- TypeScript 5.9 — pure logic modules in `src/lib/config/**`, `src/lib/utils/**`, `src/lib/stores/*.svelte.ts`, `src/lib/types/**`
- Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) — all UI in `src/routes/**` and `src/lib/components/**`

**Secondary:**
- Plain CSS with custom properties — `src/app.css` (no Tailwind, no CSS-in-JS in the shipped app; `stitch-output/screen.html` is a design mockup using the Tailwind CDN and is not part of the build)
- JSON — adapter metadata `io-package.json`, PWA manifest `static/manifest.json`, state documents (page/device/template/formula lists)
- HTML — SvelteKit shell `src/app.html`

## Runtime

**Environment:**
- Node.js — declared `>= 18.0.0` in `package.json` (`engines`). Note the actual toolchain is stricter: Vite 7.3.7 requires `^20.19.0 || >=22.12.0`, Vitest 4 requires `^20 || ^22 || >=24`. CI runs Node 22.x and 24.x (`.github/workflows/test-and-release.yml`). The adapter itself only needs Node 18+ (`@iobroker/adapter-core` 3.4.3).
- Browser — modern evergreen browser for the SPA; service worker only in a secure context (https or localhost), so plain-HTTP LAN installs run without PWA caching.

**Package Manager:**
- npm, lockfile v3 present (`package-lock.json`)
- Runtime dependency count: exactly one (`@iobroker/adapter-core`)

## Frameworks

**Core:**
- `@iobroker/adapter-core` 3.4.3 — adapter lifecycle (`utils.Adapter`), state/object API, logging; used in `main.js`
- `@sveltejs/kit` 2.70.3 — SPA shell, hash router, service-worker build
- `svelte` 5.57.2 — components and runes-based reactive stores
- `@sveltejs/adapter-static` 3.0.10 — prerenders to `www/` with `fallback: "index.html"` (SPA)
- `vite` 7.3.7 — dev server and bundler
- `@sveltejs/vite-plugin-svelte` 6.2.4 — Svelte compilation

**Testing:**
- `vitest` 4.1.11 — unit tests; config embedded in `vite.config.mjs` (`environment: "node"`, `include: src/**/*.{test,spec}.{js,ts}`, `expect.requireAssertions: true`)
- `mocha` 12.0.3 + `@iobroker/testing` 6.3.1 — package-file validation (`test/package.js`) and real-controller integration (`test/integration.js`)

**Build/Dev:**
- `svelte-check` 4.4.6 — type checking (`npm run check`)
- `eslint` 8.57.1 flat config (`eslint.config.mjs`) + `eslint-plugin-svelte`, `@typescript-eslint`, `eslint-plugin-prettier`
- `prettier` 3.9.9 + `prettier-plugin-svelte` (`.prettierrc.json`, `endOfLine: "auto"`)
- `@alcalzone/release-script` 5.2.1 with `iobroker`, `license`, `manual-review` plugins (`.releaseconfig.json`)

## Key Dependencies

**Critical:**
- `@iobroker/adapter-core` 3.4.3 — the only production dependency; owns `ihome.0.config.*` states and the one-shot migration in `main.js`
- `@iobroker/ws` 3.1.3 — devDependency, bundled into `www/`; the ioBroker WebSocket protocol client (MIT, bluefox), upstream of the copy that used to be vendored as `src/lib/iobroker.socket.io.js`. It drives the raw WebSocket protocol against `…/socket.io`, so do not replace it with `socket.io-client`.
- `workbox-precaching` 7.4.1 — service-worker precache of hashed assets in `src/service-worker.js`

**Infrastructure:**
- `typescript` 5.9.3 with a deliberately loose tsconfig (`strict: false`, `tsconfig.json` extends generated `.svelte-kit/tsconfig.json`)
- `globals` 15, `@eslint/js` 8.57.1, `svelte-eslint-parser` 1.8.1, `tslib` 2.4

## Configuration

**Environment:**
- `VITE_SOCKET_URL` — overrides the ioBroker socket URL in dev; read in `src/lib/socket-url.ts`, first in the order `VITE_SOCKET_URL` → `?socket=` → the configured fallback `FALLBACK_BROKER` (`src/lib/broker-config.ts`, empty by default) → the page host.
- `IOBROKER_MCP` — base URL of the broker's MCP endpoint used by `scripts/deploy-www.mjs` (default `http://localhost:8082/mcp/`).
- `.env.development.local` is present locally and gitignored (`.gitignore` covers `.env` and `.env.*`); it holds the dev broker override. Do not read or commit its values.
- `?socket=wss://host/path/socket.io` — per-page runtime override for reverse proxies (`src/lib/socket-url.ts`).

**Build:**
- `vite.config.mjs` — holds the SvelteKit config (there is no `svelte.config.js`; the package is CommonJS, so Node cannot import an ESM config). Production `paths.base` is `/ihome`, router type is `hash`, SvelteKit service-worker registration is disabled in favor of manual registration in `src/routes/+layout.svelte`, output bundle strategy is `"inline"`, dev watcher uses polling (`watch.usePolling`, 300 ms) for OneDrive.
- `eslint.config.mjs` — flat config with per-directory overrides (CommonJS allow-listed, `any` allowed in TS).
- `tsconfig.json` — `strict: false`, `skipLibCheck: true`, `resolveJsonModule: true`.
- `package.json` `files` — ships `admin/`, `www/`, `io-package.json`, `LICENSE`, `README.md`, `main.js`.

**Adapter metadata (`io-package.json`):**
- `common.mode: "once"`, `singleton: true`, `compact: true`, `adminUI.config: "none"`, no `objects`/`instanceObjects`/`native` config.
- Requires `js-controller >= 6.0.11`; global dependency `admin >= 7.0.23`.
- `localLinks.ihome` points at `%web_protocol%://%ip%:%web_port%/ihome/index.html`.

## Scripts

```bash
npm run dev            # Vite dev server on :5173, CORS *, polling watcher
npm run build          # SvelteKit static build into www/
npm run pack           # build + npm pack (iobroker.ihome-<version>.tgz)
npm run deploy:www     # upload built www/ to a live broker over its MCP endpoint
npm run preview        # serve the built www/
npm run test           # test:unit + test:package + test:integration
npm run test:unit      # vitest run (33 test files)
npm run test:package   # mocha test/package.js --exit
npm run test:integration # mocha test/integration.js --exit
npm run check          # svelte-kit sync && svelte-check
npm run lint           # eslint -c eslint.config.mjs .
npm run release        # @alcalzone/release-script
```

## Platform Requirements

**Development:**
- Node 20.19+/22.12+ in practice (Vite 7); npm; a running ioBroker broker for real data (dev broker configured via `.env.development.local`).
- No SvelteKit CLI scaffold; config lives entirely in `vite.config.mjs`.

**Production:**
- ioBroker installation: `js-controller >= 6.0.11`, `admin >= 7.0.23`, and the `web` adapter to serve `/ihome/` (observed live broker: js-controller 7.2.5, Node 24.19.0, web 9.1.16 — see `docs/progress/handoff-2026-10-22-iobroker-visual-adapter.md`).
- Installed from GitHub as a custom URL; `www/` is committed because GitHub installs do not run a frontend build.
- The adapter needs no external database; all persistence is ioBroker states. History charts additionally require a history-capable adapter (see `INTEGRATIONS.md`).

---

*Stack analysis: 2026-10-22*
