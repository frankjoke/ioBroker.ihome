---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
<!-- refreshed: 2026-10-22 -->

# Codebase Structure

**Analysis Date:** 2026-10-22

## Directory Layout

```text
iobroker-visual-adapter/
├── main.js                     # ioBroker adapter entry (mode: once) — creates ihome.0.config.* states
├── io-package.json             # Adapter metadata (once-mode, no config UI, localLinks, deps)
├── package.json                # Scripts, deps, engines, release config
├── vite.config.mjs             # SvelteKit build (hash router, base /ihome) + Vitest config
├── tsconfig.json               # TS config (extends .svelte-kit/tsconfig.json)
├── eslint.config.mjs           # ESLint flat config (ts + svelte + prettier)
├── src/
│   ├── app.html                # Pre-paint theme script, PWA meta
│   ├── app.css                 # CSS custom properties, dark class, layout tokens
│   ├── service-worker.js       # Workbox precache, network-first navigations
│   ├── lib/
│   │   ├── config/             # Pure domain layer (ops + tests) — 46 files
│   │   ├── stores/             # Rune-based document/read-model stores
│   │   ├── components/         # common | config | discovery | display | layout
│   │   ├── types/              # device.ts, display.ts
│   │   ├── utils/              # debounce, ids, json, transform, icon-url, control-write
│   │   ├── ioBrokerConnect.svelte.js   # Socket + cache hydration + RPC
│   │   ├── iobroker.socket.io.js       # Vendored WS protocol client v3.0.4
│   │   ├── StateClass.svelte.js        # ObjectMap/StateMap/EnumMap/CustomMap/StateClass
│   │   ├── registry.svelte.js          # deviceList load/save
│   │   ├── formulas.svelte.js          # formulaList load/save
│   │   ├── localStorage.js             # __VISUAL__: prefixed helpers
│   │   └── tools.svelte.js             # Misc UI helpers (heavily @ts-ignore'd)
│   └── routes/                 # +layout, +page, p/[id], devices, settings, config/devices
├── static/                     # PWA icons, manifest, favicons (copied by build)
├── www/                        # Committed SvelteKit build output (11 files) — served by web adapter
├── test/                       # mocha: package.js (adapter packaging), integration.js (js-controller)
├── scripts/deploy-www.mjs      # Uploads www/ to the broker file namespace via MCP
├── docs/                       # progress/ handoffs, superpowers/ plans + specs
├── admin/                      # Adapter admin assets (no config UI)
└── vis/                        # vis adapter assets
```

## Directory Purposes

**`src/lib/config/`:**
- Purpose: the pure domain layer — every rule that can be tested without a browser or broker.
- Contains: paired `X.ts` + `X.test.ts` modules (ops, parsers, math, formatting).
- Key files: `pages-ops.ts`, `tile-ops.ts`, `template-ops.ts`, `layout-ops.ts`, `rule-ops.ts`, `transform-ops.ts`, `virtual-ops.ts`, `history-ops.ts`, `size-ops.ts`, `doc-parse.ts`, `features.ts`, `presets.ts`, `format.ts`, `icon-ops.ts`, `state-tree.ts`, `sort.ts`, `units.ts`, `rooms.ts`, `section-layout.ts`, `sheet-cursor.ts`, `tile-hit.ts`, `tile-parts.ts`, `appearance.ts`, `control-ops.ts`, `project.ts`, `formulas.ts`.

**`src/lib/stores/`:**
- Purpose: rune-based singletons holding in-memory documents and derived read models.
- Contains: page/template/device/formula/history/sheet stores plus `devices.ts` (non-rune helpers).
- Key files: `pages.svelte.ts`, `templates.svelte.ts`, `devices.svelte.ts`, `formulas.svelte.ts`, `history.svelte.ts`, `sheet.svelte.ts`.

**`src/lib/components/display/`:**
- Purpose: render the dashboard — `PageView` → `GroupSection` → `Tile` → `SlotRenderer` → `slots/*`.
- Contains: renderer components, charts (`TileChart.svelte`), modals (`TileModal.svelte`, `ModalPanel.svelte`), badges.

**`src/lib/components/layout/`:**
- Purpose: the layout sheet editor (open/closed mode from `stores/sheet`).
- Contains: `LayoutSheet.svelte`, `LayoutDetails.svelte`, `DevicePicker.svelte`, `SlotPicker.svelte`.

**`src/lib/components/config/`:**
- Purpose: device and control editors used by `/devices` and `/settings`.
- Contains: `DeviceForm.svelte`, `ControlRow.svelte`, `TransformEditor.svelte`, `HistoryEditor.svelte`, `HistorySummary.svelte`, `VirtualEditor.svelte`.

**`src/lib/components/discovery/`:**
- Purpose: browse and pick broker states/objects from the full object cache.
- Contains: `StateTree.svelte`, `StatePicker.svelte`.

**`src/lib/components/common/`:**
- Purpose: shared primitives used across routes.
- Contains: `Icon.svelte`, `IconPicker.svelte`, `MultiSelect.svelte`, `ConfirmModal.svelte`, `BackgroundEditor.svelte`, `EnumBadge.svelte`.

**`src/routes/`:**
- Purpose: URL surface. Hash routing (`router.type: "hash"`), base `/ihome`.
- Contains: `+layout.svelte` (boot), `+page.svelte` (display), `p/[id]/+page.svelte` (single page), `devices/`, `settings/`, `config/devices/+page.ts` (legacy redirect).

**`test/`:**
- Purpose: adapter-level mocha tests, separate from the Vitest unit suite.
- Contains: `package.js` (packaging/structure), `integration.js` (needs a real js-controller).

**`www/`:**
- Purpose: the built SPA that the ioBroker `web` adapter serves at `/ihome/`.
- Generated: yes (`npm run build`) — committed to git, so it can drift from `src/`.

**`docs/`:**
- Purpose: session handoffs (`docs/progress/`) and design/plan history (`docs/superpowers/plans`, `docs/superpowers/specs`).

## Key File Locations

**Entry Points:**
- `main.js`: adapter process; creates `ihome.0.config.{pageList,deviceList,templateList,formulaList}` and exits.
- `src/app.html`: HTML shell with the pre-paint theme script.
- `src/routes/+layout.svelte`: SPA bootstrap — connect, start stores, seed pages, register SW.
- `src/routes/+page.svelte`: display route.

**Configuration:**
- `vite.config.mjs`: SvelteKit + adapter-static + hash router + Vitest `include: ["src/**/*.{test,spec}.{js,ts}"]`.
- `io-package.json`: adapter metadata, `localLinks`, instance objects.
- `eslint.config.mjs`, `.prettierrc.json`, `tsconfig.json`: lint/format/type config.
- `package.json` scripts: `dev`, `build`, `pack`, `deploy:www`, `test` (`test:unit` → vitest, `test:package` / `test:integration` → mocha), `check`, `lint`, `release`.

**Core Logic:**
- `src/lib/config/*.ts`: pure domain operations (document truth, layout math, rules, formatting).
- `src/lib/ioBrokerConnect.svelte.js`: socket lifecycle, cache hydration, `getState`/`setState`/`getHistory` RPC.
- `src/lib/StateClass.svelte.js`: reactive maps over broker objects and states.
- `src/lib/stores/*.svelte.ts`: document load/parse/commit/debounced-write paths.

**Testing:**
- `src/**/*.test.ts`: 33 Vitest files, co-located next to the module under test.
- `test/package.js`, `test/integration.js`: mocha adapter tests.

## Naming Conventions

**Files:**
- Pure domain module + its test: `tile-ops.ts` / `tile-ops.test.ts`.
- Reactive module (runes): `pages.svelte.ts`; legacy JS equivalents: `registry.svelte.js`.
- Svelte components: `PascalCase.svelte` (`LayoutSheet.svelte`, `TileChart.svelte`).
- Routes: SvelteKit file conventions (`+page.svelte`, `+layout.svelte`, `+page.ts`).

**Directories:**
- `src/lib/config/` for pure logic, `src/lib/stores/` for reactive singletons, `src/lib/components/<area>/` for UI grouped by feature area.

## Where to Add New Code

**New Feature (domain rule):**
- Primary code: `src/lib/config/<area>-ops.ts` (pure, no store/socket/DOM imports).
- Tests: `src/lib/config/<area>-ops.test.ts`.

**New Feature (UI):**
- Implementation: `src/lib/components/<area>/<Name>.svelte`; read/mutate through a store, never edit documents directly.
- Route (if it needs a URL): `src/routes/<name>/+page.svelte`.

**New Document/Store:**
- Store: `src/lib/stores/<name>.svelte.ts` + `src/lib/<name>.svelte.js` persistence pair (pattern: `registry.svelte.js` / `formulas.svelte.js`).
- Wire the new state into `main.js` `DOCS` and `io-package.json` objects.

**Utilities:**
- Shared helpers: `src/lib/utils/<name>.ts` (+ `.test.ts`).

**New UI string/theme token:**
- Theme: CSS custom properties in `src/app.css`; layout metrics only via `BREAKPOINTS` in `src/lib/config/size-ops.ts`.

## Special Directories

**`www/`:**
- Purpose: built SPA served by the ioBroker web adapter at `/ihome/`.
- Generated: yes (`npm run build`); deployed by `scripts/deploy-www.mjs` or shipped in the npm package.
- Committed: yes (11 tracked files) — regenerating without committing leaves the shipped UI stale.

**`static/`:**
- Purpose: PWA icons, `manifest.json`, favicons; copied verbatim by the build.
- Generated: no. Committed: yes.

**`.svelte-kit/`, `graphify-out/`, `.serena/`, `.playwright-mcp/`:**
- Purpose: build output / tooling caches.
- Generated: yes. Committed: no (gitignored).

**`stitch-output/`, `iobroker.ihome-0.0.10.tgz`:**
- Purpose: design-tool output and a packed adapter tarball used by the admin install dialog.
- Generated: yes. Committed: present in the working tree (`*.tgz` is gitignored).

---

*Structure analysis: 2026-10-22*
