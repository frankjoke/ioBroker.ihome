---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
<!-- refreshed: 2026-10-22 -->

# Architecture

**Analysis Date:** 2026-10-22

## System Overview

iHome is a two-part system: a **one-shot ioBroker adapter** (`main.js`) that owns four JSON documents and exits, and a **static Svelte 5 SPA** (`src/`) that the ioBroker `web` adapter serves at `/ihome/` and that talks to the broker directly over a WebSocket.

```text
┌───────────────────────────────────────────────────────────────────────┐
│  ioBroker broker (js-controller, Node)                                │
│  ihome.0.config.{pageList,deviceList,templateList,formulaList}        │
│  every state / object / enum · history providers                     │
└───────────────▲───────────────────────────────┬───────────────────────┘
                │ setState / setObject          │ stateChange / objectChange
                │ getState / getAllObjects      │ getAllObjects / getHistory
                │ getHistory                    │
┌───────────────┴───────────────────────────────▼───────────────────────┐
│  SPA (browser) — served by web adapter at /ihome/index.html           │
│                                                                       │
│  Transport      ioBrokerConnect.svelte.js                             │
│                 @iobroker/ws (published WS client)                   │
│                 StateClass.svelte.js (objects/states/enums/customs)   │
│                                                                       │
│  State stores   stores/pages · templates · devices · formulas         │
│                 registry.svelte.js · formulas.svelte.js               │
│                 stores/history · stores/sheet                         │
│                                                                       │
│  Domain         lib/config/** (pure TS: ops, rules, templates, …)     │
│                 lib/utils/** · lib/types/**                           │
│                                                                       │
│  UI             routes/** (+layout, display, devices, settings)       │
│                 lib/components/** (display, layout, config, …)        │
└───────────────────────────────────────────────────────────────────────┘
                ▲                                   ▲
                │ build (vite → www/)               │ package install / MCP upload
┌───────────────┴───────────────┐   ┌───────────────┴───────────────────┐
│ ioBroker adapter package      │   │ scripts/deploy-www.mjs            │
│ main.js · io-package.json     │   │ uploads www/ into broker storage  │
│ www/ (committed build)        │   │ namespace `ihome/` over MCP       │
└───────────────────────────────┘   └───────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Adapter lifecycle | Creates `ihome.0.config.*` JSON states, copies legacy data, removes old root states, exits (`mode: "once"`) | `main.js` |
| App shell / bootstrap | Connects socket, starts every document store, installs rune-derived data sources, seeds pages, registers service worker, theme | `src/routes/+layout.svelte` |
| Display route | Renders the last page and hosts the layout sheet as a mode | `src/routes/+page.svelte` |
| Page-by-id route | Renders one page, bookmarkable hash route, falls back to first page | `src/routes/p/[id]/+page.svelte` |
| Devices route | Device registry CRUD, filters, sorting, device form, history summary | `src/routes/devices/+page.svelte` |
| Settings route | Connection (host/namespace), theme, formula library | `src/routes/settings/+page.svelte` |
| Legacy redirect | `/config/devices` → `/#/devices` | `src/routes/config/devices/+page.ts` |
| Socket integration | Connect/reconnect, RPC timeouts, cache hydration, inbound event fan-out, `setState` stamping | `src/lib/ioBrokerConnect.svelte.js` |
| WebSocket client | Published ioBroker WebSocket protocol client `@iobroker/ws` v3.1.3 (reconnect, ping, callbacks) | devDependency, bundled into `www/` |
| Reactive caches | `ObjectMap`, `StateMap`, `EnumMap`, `CustomMap` built on `SvelteMap`; `StateClass` wraps one state's value + object | `src/lib/StateClass.svelte.js` |
| Page document store | Load/parse/seed `pageList`, view state, debounced writes, migration to placements | `src/lib/stores/pages.svelte.ts` |
| Template document store | Load/parse `templateList`, guarded commit + debounced write | `src/lib/stores/templates.svelte.ts` |
| Device registry store | Canonical device list, used-state set, enrichment with live values/virtuals/icons, polling readable stores | `src/lib/stores/devices.svelte.ts` |
| Device persistence | Load/parse/save `deviceList`, enum backfill trigger | `src/lib/registry.svelte.js` |
| Formula library store | In-memory formula list + CRUD | `src/lib/stores/formulas.svelte.ts` |
| Formula persistence | Load/migrate/seed/save `formulaList` | `src/lib/formulas.svelte.js` |
| History cache | Fetch/cache `getHistory` series, append live samples | `src/lib/stores/history.svelte.ts` |
| Sheet state | Layout editor open/closed mode | `src/lib/stores/sheet.svelte.ts` |
| Domain layer | Pure document operations, template chain, rules, layout math, formatting | `src/lib/config/*.ts` |
| Display components | Page → section → tile → slot rendering, modals, charts, badges | `src/lib/components/display/**` |
| Layout editor | Sheet UI, selection drill-down, device/slot pickers, tile details | `src/lib/components/layout/**` |
| Config editors | Device form, control row, transform/history/virtual editors | `src/lib/components/config/**` |
| Discovery | State tree/picker over the full object cache | `src/lib/components/discovery/**` |
| Shared UI | Icon, icon picker, multi-select, confirm modal, backgrounds, enum badge | `src/lib/components/common/**` |
| Service worker | Precache hashed build assets, network-first navigations, immediate takeover | `src/service-worker.js` |
| Build config | SvelteKit (hash router, base `/ihome`, SPA fallback) + Vitest config | `vite.config.mjs` |
| Adapter metadata | `mode: once`, no config UI, `localLinks`, dependencies | `io-package.json` |
| UI deploy script | Walk `www/`, upload to broker file namespace via MCP, delete stale files | `scripts/deploy-www.mjs` |

## Pattern Overview

**Overall:** Layered static SPA with a **pure functional domain core**, **rune-based singleton stores**, and a **thin CJS adapter**.

**Key Characteristics:**
- No server-side code in the SPA: `@sveltejs/adapter-static` with `fallback: "index.html"` and `router.type: "hash"` (`vite.config.mjs`).
- The broker is the database. Persistence is JSON in ioBroker states, read once on connect and kept live via `onUpdate`.
- Domain logic is pure and unit-tested (`src/lib/config/**` imports nothing from stores, socket, components, or the DOM — verified by import scan).
- UI components never mutate documents directly; they call pure `*-ops.ts` functions and commit through a store write path.
- The document is the truth for layout; device data is a separate registry, enriched at read time with live values, templates, and object metadata.
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) throughout; reactive module singletons live in `*.svelte.ts` / `*.svelte.js`.

## Layers

**Adapter / Persistence (Node):**
- Purpose: own the dashboard JSON states, run migrations, exit.
- Location: `main.js`, `io-package.json`.
- Contains: `utils.Adapter` subclass, `DOCS` list, legacy copy logic, placeholder detection.
- Depends on: `@iobroker/adapter-core` only.
- Used by: ioBroker js-controller at instance start.

**Transport / Integration:**
- Purpose: one socket, one set of caches, one RPC surface.
- Location: `src/lib/ioBrokerConnect.svelte.js`, `src/lib/broker-config.ts`, `src/lib/StateClass.svelte.js`, `src/lib/socket-url.ts`, `src/lib/states.svelte.js`.
- Contains: `ioBroker` rune object, `connectIOBroker`, `emitAsync`, `emitOnly`, `getState`, `getObject`, `setState`, cache classes, used-state loader.
- Depends on: the published `@iobroker/ws` client, `stores/devices` (only for `getUsedStateIds`).
- Used by: every store and component that reads/writes broker data.

**State Stores (application state):**
- Purpose: hold the in-memory documents and derived read models.
- Location: `src/lib/stores/*.svelte.ts`, `src/lib/registry.svelte.js`, `src/lib/formulas.svelte.js`.
- Contains: page registry + view state, template registry, device registry + enrichment, formula library, history cache, sheet mode.
- Depends on: `lib/config/**`, `lib/types/**`, `lib/ioBrokerConnect.svelte.js`, `lib/states.svelte.js`.
- Used by: routes and components.

**Domain (pure):**
- Purpose: all rules that can be unit-tested without a browser or broker.
- Location: `src/lib/config/**`, `src/lib/utils/**`, `src/lib/types/**`.
- Contains: layout/page/tile/template/rule/history/transform/virtual operations, presets, feature catalog, formatting, size math, icon resolution, state-tree filtering, document parsing.
- Depends on: types and other pure modules only.
- Used by: stores, components, routes.

**UI Components:**
- Purpose: render and edit; own only transient widget state.
- Location: `src/lib/components/**`.
- Contains: display renderer (`PageView` → `GroupSection` → `Tile` → `SlotRenderer` → `slots/*`), layout sheet, config forms, discovery pickers, shared primitives, `AppBar`.
- Depends on: stores, domain, types, `ioBroker` for direct reads, `pages.js` handoffs.
- Used by: routes.

**Routes / Shell:**
- Purpose: URL surface and boot sequence.
- Location: `src/routes/**`, `src/app.html`, `src/app.css`.
- Contains: global layout, display routes, config routes, PWA metadata/theme bootstrap.
- Depends on: all lower layers.

**Build / Deploy:**
- Purpose: produce and ship the static SPA and the adapter package.
- Location: `vite.config.mjs`, `src/service-worker.js`, `static/`, `www/`, `scripts/deploy-www.mjs`, `.github/workflows/test-and-release.yml`.
- Contains: SvelteKit config, service worker, PWA assets, committed build output, MCP uploader, CI.
- Depends on: source; consumed by the ioBroker web adapter.

## Data Flow

### Primary Boot / Hydration Path

1. `src/routes/+layout.svelte` reads `hostPort`/`namespace` from localStorage (`__VISUAL__:` prefix) and calls `ioBrokerStart({ namespace, url })`.
2. `src/lib/ioBrokerConnect.svelte.js` creates/reuses the socket, connects to `ws(s)://<page-host>:8081/socket.io`, emits `name`, then hydrates caches: `getAllObjects` → `objects`, `enums.init(objects)`, `customs.init(objects)`, then `subscribe *` and `subscribeObjects *` (`connectIOBroker`, lines 228-358).
3. `onMount` in `+layout.svelte` starts `initRegistry()`, `initFormulas()`, `initTemplates()`, `loadViewState()`, `initPages(seedDisplayPages)` and registers the service worker with `updateViaCache: "none"` (lines 124-147).
4. Each document store waits for `ioBroker.connected`, creates its `ihome.0.config.*` object if missing, calls `getState`, installs `st.onUpdate` (with echo suppression), and parses the value.
5. A layout `$effect` fires when connected: it injects `ioBroker.states` and `ioBroker.objects` into the device store (`setStateSource`/`setObjectSource`), calls `reloadUsedStates()`, waits for the enum cache, runs `backfillDeviceEnums()`, then `initPages(...)` and `migrateLayout(canonical devices)` (`+layout.svelte` lines 74-102).
6. `initPages` seeds a room page and a function page from broker enums when no document exists (`seedPages`, `src/lib/config/pages-ops.ts`); the seed is **not written** until the user commits an edit.

### Document Read Path

1. Store gets the state via `ioBroker.getState(ID)` (`StateClass`/`StateMap`).
2. Raw value may be `{ val }`, a JSON string, or an object — `unwrapDoc`/`parseDoc` normalize it (`src/lib/config/doc-parse.ts`).
3. A typed shape validator accepts or rejects it (`parsePageRegistry`, `parseTemplateRegistry`, `parseRegistry`, `migrateLibrary`).
4. Invalid content is **left untouched** and reported; it is never replaced by an empty in-memory value.
5. `st.onUpdate` re-applies external changes; `lastSent` suppresses the echo of this client's own write.

### Document Write Path

1. UI builds a new document through pure ops (`layout-ops`, `tile-ops`, `template-ops`, `rule-ops`, `control-ops`, `pages-ops`).
2. Pages/templates call `commitLayout(next)` / `commitTemplates(next)`, which refuse unless a successful load (or seed) occurred (`isLayoutWritable`/`isTemplatesWritable`).
3. Device edits call `setCanonicalRegistry(...)` then `saveRegistry()` (`src/lib/registry.svelte.js`); formulas call `upsertFormula`/`deleteFormula` then `saveFormulas()` (`src/lib/formulas.svelte.js`).
4. Writes are debounced 250 ms, then `ioBroker.setState(ID, JSON.stringify(doc))`; state ids are stamped `from: "system.adapter.<namespace>"` in `setState`.
5. Failures set `saveFailed` (pages/templates) so the editor can show "not saved"; a disconnected socket is treated as a failure rather than a silent success.

### Display Render Path

1. `src/routes/+page.svelte` picks the last viewed page (`view.lastPage`, localStorage `iHome.view`) or first page; `src/routes/p/[id]/+page.svelte` picks by id.
2. `PageView.svelte` maps `$devicesEnrichedStore` through `toFilterable`, resolves placements with `resolvePage`, computes the container breakpoint (`breakpointFor`), and places tiles with `layoutSection` (`src/lib/config/section-layout.ts`).
3. `GroupSection.svelte` renders sections in flex flow; `Tile.svelte` resolves template → slots → rules → icon/badge/chart parts via `tileParts` (`src/lib/config/tile-parts.ts`).
4. `SlotRenderer.svelte` dispatches to `ValueSlot`, `ControlWidget`, `HistoryListSlot`, or `FrameSlot`.
5. `TileModal.svelte` renders the detail page with a native `<dialog>` (`showModal`, or `show()` for the sheet's non-blocking preview).

### Control Write Path

1. `Tile.svelte` / `ControlWidget.svelte` calls `writeControl(ioBroker, control, value, now, { lockMs })` (`src/lib/utils/control-write.ts`).
2. Refuses if no `stateId`, not writable, or unavailable; toggles are locked per state id until the broker echoes the written value (or a ceiling passes).
3. Applies `applyWrite` (inverse transform) and calls `ioBroker.setState`; the live `stateChange` event updates the cache and re-renders.

### History Path

1. `TileChart`/`HistoryListSlot` call `ensureHistory(client, stateId, spec)` (`src/lib/stores/history.svelte.ts`).
2. `buildHistoryOptions` produces `getHistory` options (`src/lib/config/history-ops.ts`); `toSeries` reduces rows to `{ ts, val }`.
3. Results are cached by `historyKey`; live samples are appended by `noteLive` without refetching.

### Navigation / Handoff Path

- Config tabs are programmatic: `src/lib/pages.js` exports `pages` (`/devices`) and `pageHref`; the app bar renders them.
- Ctrl/Cmd+click a tile/section/page tab asks for the layout editor: `requestLayoutConfig(ref)` stores JSON under sessionStorage key `iHome.editLayout`, then `openSheet()`.
- Ctrl/Cmd+click a control asks for the device form: `requestDeviceConfig(id)` uses sessionStorage key `iHome.edit`.
- The target route takes and clears the handoff (`takeRequestedLayout`, `takeRequestedDeviceConfig`); sessionStorage (not module state) survives Vite HMR duplicates.

### Service Worker / Update Path

- `src/service-worker.js` precaches hashed assets but **not** the shell; navigations are network-first (`cache: "no-cache"`), falling back to the `ihome-shell` cache offline.
- `install` calls `skipWaiting`, `activate` calls `clients.claim`.
- Registration is manual in `+layout.svelte` so `updateViaCache: "none"` defeats the web adapter's cache headers.
- On plain HTTP LAN origins there is no service worker at all (not a secure context).

**State Management:**
- Module-level rune singletons: `$state` in `pages.svelte.ts`, `templates.svelte.ts`, `devices.svelte.ts`, `formulas.svelte.ts`, `sheet.svelte.ts`, `history.svelte.ts` (`SvelteMap`).
- `devices.svelte.ts` exposes legacy readable stores polled every 50 ms (`devicesEnrichedStore`, `availableStatesTreeStore`, `canonicalRegistryStore`) because the enriched model is computed, not stored.
- Local UI state stays in components (`$state`); persisted app state lives in the stores; view state lives in localStorage.

## Key Abstractions

**Registry document pattern:**
- Purpose: uniform load → parse → subscribe → commit → debounced save for a JSON state.
- Examples: `src/lib/stores/pages.svelte.ts`, `src/lib/stores/templates.svelte.ts`, `src/lib/registry.svelte.js`, `src/lib/formulas.svelte.js`.
- Pattern: ID constant (`PAGE_LIST_ID`, `DEVICE_LIST_ID`, `TEMPLATE_LIST_ID`, `FORMULA_LIST_ID`), `initX()` memoized by `initPromise`, `ensureXObject()` via `setObject`, `parseX()` via `doc-parse`, `lastSent` echo suppression, 250 ms debounce, `saveFailed` flag.

**Canonical vs enriched device:**
- Purpose: persisted config is separate from live read model.
- `Device`/`DeviceRegistry` (`src/lib/types/device.ts`) is stored; `EnrichedDevice`/`EnrichedControl` adds `liveValue`, `available`, `exists`, `displayRoom`, `widget`, `virtualError`, `objectIcon`.
- `getDevicesEnriched()` in `src/lib/stores/devices.svelte.ts` builds the enriched list from `canonicalRegistry` + injected state/object caches + `computeVirtual` + `widgetFor`.

**Used-state subscription set:**
- Purpose: keep only relevant states in memory and subscribed.
- `getUsedStateIds()` returns program ids (`deviceList`, `pageList`, `templateList`) plus every device `watch`/control `stateId` and every raw id read by a rule via `get("…")`.
- `src/lib/states.svelte.js` loads them in batches of 20; `stateChange` ignores ids outside the set.

**Template chain (preset → user template → device → tile):**
- Purpose: layered defaults that never need a migration.
- `mergeSlots` (`src/lib/config/template-ops.ts`) merges layers by `(kind, source, options.index)`; rules append.
- `resolveTemplate(device, templates)` picks user template or `PRESETS` (`src/lib/config/presets.ts`), falling back to `Custom`.
- On first tile edit, `materialiseTile`/`ensureTile` (`src/lib/config/tile-ops.ts`) copy a complete `{ template, size, slots }` onto the placement; later edits diverge independently.

**Pure document operations:**
- Purpose: make every structural mutation testable and non-destructive.
- `layout-ops.ts` (add/move/delete/patch page, section, placement), `tile-ops.ts` (materialise/edit tile, slots, rules, looks), `template-ops.ts`, `rule-ops.ts`, `control-ops.ts`, `history-ops.ts`, `transform-ops.ts`, `virtual-ops.ts`, `pages-ops.ts`.
- Contract: input never mutated; every op returns a new registry with `updatedAt` bumped; nonexistent targets return the input unchanged.

**Rule / expression engine:**
- Purpose: one expression language for slot rules, active conditions, virtual controls, and formulas.
- `buildScope`/`evaluateVirtual` (`src/lib/config/virtual-ops.ts`) expose locals (control labels/features) and helpers (`values`, `count`, `sum`, `avg`, `min`, `max`, `any`, `all`, `get`, `device`).
- `resolveStyle` (`rule-ops.ts`) evaluates top-to-bottom, last match wins; `only: true` becomes a visibility gate.

**Tile parts resolution:**
- Purpose: the display and the layout editor ask the same question.
- `tileParts(device, tile, templates, opts)` (`src/lib/config/tile-parts.ts`) returns `slots`, `rows`, `body`, `modal`, `badgeSlots`, `modalBadges`, `hasModal`; the sheet's "Detail Page" checkbox uses `hasModal` rather than a second approximation.

**Transport injection interfaces:**
- Purpose: keep pure callers unit-testable and HMR-safe.
- `WriteClient` (`src/lib/utils/control-write.ts`) and `HistoryClient` (`src/lib/stores/history.svelte.ts`) are minimal structural interfaces passed by the caller; neither module imports the socket.

**Handoff keys:**
- `iHome.edit` (device config), `iHome.editLayout` (layout anchor), `iHome.view` (last page), `__VISUAL__:hostPort`, `__VISUAL__:namespace`, `__VISUAL__:theme` (storage). All in `src/lib/pages.js`, `src/lib/stores/pages.svelte.ts`, `src/routes/+layout.svelte`, `src/lib/theme.svelte.js`, `src/lib/localStorage.js`.

## Entry Points

**Adapter entry point:**
- Location: `main.js`
- Triggers: ioBroker starts instance `ihome.0` (also `require.main === module` for direct start).
- Responsibilities: create `config.<doc>` states, migrate legacy `0_userdata.0.Test.AiHome.*` and old root states, delete old root states when safe, log, exit. No config dialog (`adminUI.config: "none"`).

**SPA shell entry point:**
- Location: `src/routes/+layout.svelte`
- Triggers: any hash route load; `src/app.html` bootstraps theme before first paint.
- Responsibilities: socket startup, document store init, cache injection, seed + migration, service worker registration, theme application, connection footer, `AppBar`.

**Display entry points:**
- `/` → `src/routes/+page.svelte` (last page + layout sheet as a mode)
- `/#/p/<id>` → `src/routes/p/[id]/+page.svelte` (bookmarkable page)

**Configuration entry points:**
- `/#/devices` → `src/routes/devices/+page.svelte`
- `/#/settings` → `src/routes/settings/+page.svelte`
- `/#/config/devices` → redirect to `/#/devices` (`src/routes/config/devices/+page.ts`)

**Service worker entry point:**
- Location: `src/service-worker.js`
- Triggers: registered by `+layout.svelte` in production, secure contexts only.
- Responsibilities: precache hashed assets, network-first navigations, offline shell fallback.

**Deploy entry point:**
- Location: `scripts/deploy-www.mjs`
- Triggers: `npm run deploy:www` with `IOBROKER_MCP` set.
- Responsibilities: MCP JSON-RPC session, list remote, create dirs, upload `www/` (base64 for binaries), delete stale files.

## Architectural Constraints

- **Rendering:** Static SPA only. `@sveltejs/adapter-static`, `fallback: "index.html"`, `strict: true`; no server routes or `+page.server.ts`.
- **Routing:** `router.type: "hash"` because the app is served from `/ihome/index.html`; all internal links are `${base}/#/...` (`src/lib/components/AppBar.svelte`, `src/lib/pages.js`).
- **Base path:** production `paths.base = "/ihome"`; dev is empty (`vite.config.mjs`). Components must use `base` from `$app/paths`, not hardcoded `/ihome`.
- **Package format:** the npm package is CommonJS (`main.js`), so the ESM SvelteKit config lives in `vite.config.mjs`; there is no `svelte.config.js`.
- **No server auth:** the socket connects like any ioBroker client and relies on the broker/web adapter's own access control. Writes are stamped `system.adapter.<namespace>` but that is identity, not authentication.
- **Single broker namespace:** `DEFAULT_NAMESPACE = "ihome.0"`; document ids are hardcoded `ihome.0.config.*` in the stores even though the connection namespace is configurable.
- **Module singletons:** stores are module-level rune state. They are shared by every importer; tests must reset or inject dependencies (`resetWriteLocks`, `WriteClient`, `HistoryClient`).
- **HMR duplication:** Vite can instantiate one module twice. Do not store the socket client in a module-global of a pure/store module; import the shared `ioBroker` module directly (documented in `src/lib/stores/pages.svelte.ts` lines 5-8) or pass a client interface. Cross-navigation handoffs use sessionStorage (`src/lib/pages.js`).
- **Import cycle avoidance:** `ioBrokerConnect.svelte.js` imports `getUsedStateIds` from `stores/devices.svelte.js` at the bottom of the file; the device store must not import the socket. This is why the store receives `setStateSource`/`setObjectSource` from the layout.
- **Browser APIs at module scope:** `ioBrokerConnect.svelte.js` touches `navigator`, `document`, and `location` at import time, so it is browser-only and not SSR-safe. The app is not server-rendered.
- **Type strictness:** `tsconfig.json` has `strict: false`; several legacy modules are `// @ts-nocheck` (`ioBrokerConnect.svelte.js`, `StateClass.svelte.js`, `registry.svelte.js`, `formulas.svelte.js`, `tools.svelte.js`, `picker-values.svelte.js`). New domain code is typed.
- **New-code layering:** `src/lib/config/**` must not import stores, components, or the socket (current import scan is clean). Keep it that way; it is what makes the 30+ test files possible.
- **Document compatibility:** documents are versioned (`PageRegistry.version`, `PAGE_REGISTRY_VERSION = 1`) and migrated idempotently on connect; parsing is shape-validated and invalid documents are never overwritten.
- **Offline/PWA:** service worker only exists in secure contexts; plain-HTTP LAN installs behave as a normal SPA.
- **Committed build:** `www/` is tracked and shipped; `npm run build` must run before committing UI changes. Never edit `www/` by hand.

## Anti-Patterns

### Writing a document before a successful read

**What happens:** A store or editor writes its in-memory default when `getState` returned nothing or an error, replacing the user's real document with an empty one. Historically the SPA auto-saved a page seed and overwrote migrated documents.
**Why it's wrong:** An empty read means "not loaded yet" or "not reachable", not "the user wants this". A single write destroys configuration that the adapter or another tab still holds.
**Do this instead:** Follow `loadPages`/`mayWritePages` (`src/lib/config/pages-ops.ts`) and the guarded `commitLayout`/`commitTemplates`; keep seeds in memory only; never save from `initX`.

### Ad-hoc JSON parsing or save logic inside a component/store

**What happens:** A new editor parses `state.val` with `JSON.parse` directly, or calls `setState` without echo suppression or a connected check.
**Why it's wrong:** The value can be `{ val }`, a string, or an object; two tabs echo each other into loops; a disconnected socket resolves writes silently (`emitAsync` returns `undefined`).
**Do this instead:** Use `unwrapDoc`/`parseDoc` plus a typed shape validator (`src/lib/config/doc-parse.ts`), and the registry pattern with `lastSent`, a 250 ms debounce, and an explicit connected check (`src/lib/stores/pages.svelte.ts` lines 112-133).

### Holding a module-global socket client in a reusable module

**What happens:** A store captures `ioBroker` at import time in a module-local variable or caches a raw client in a module global.
**Why it's wrong:** Vite HMR can hand two importers two module instances; one holds a stale/null client and the app desynchronizes (documented in `src/lib/pages.js` and `src/lib/stores/pages.svelte.ts`).
**Do this instead:** Import the shared `ioBroker` rune module directly, or accept a minimal interface (`WriteClient`, `HistoryClient`) from the caller. Use sessionStorage for handoffs that cross a navigation.

### Growing editor state inside the monolith

**What happens:** `src/lib/components/layout/LayoutDetails.svelte` (2352 lines) and `LayoutSheet.svelte` (931 lines) already hold many `$state` flags for selection, modes, pickers, and pending confirmations.
**Why it's wrong:** New structural rules added there are hard to unit-test and duplicate logic that already exists in `layout-ops.ts`/`tile-ops.ts`.
**Do this instead:** Add mutations as pure functions in `src/lib/config/*-ops.ts` with a co-located test, and keep the component to wiring + presentation. Reuse the existing `sheetCursor`/`parseLayoutRef` helpers for selection.

## Error Handling

**Strategy:** Degrade, never destroy. Data boundaries validate and return `null`/fallbacks; writes are checked and surfaced; the UI keeps showing the last good value.

**Patterns:**
- Document parse failure → `null`, caller keeps current state; logs "unreadable — leaving it untouched" (`initPages`, `initTemplates`).
- Store commit refusal when not loaded → `console.error` + `false` return (`commitLayout`, `commitTemplates`).
- Save failure → `saveFailed` rune flag displayed by the editor; disconnected socket counts as failure.
- Socket connect failure → 10 s rejection, `connected = 0`, footer shows host/namespace fields; RPC timeout 15 s (`emitAsync`), 30 s (`sendTo`).
- Control write failure → caught and `console.warn`, UI stays on live value (`writeControl`).
- Transform/eval failure → `runStep` catches and returns the raw value; virtual controls expose `virtualError` (`src/lib/config/virtual-ops.ts`, `src/lib/config/transform-ops.ts`).
- History failure → entry `{ status: "error" }` in the cache, no throw (`src/lib/stores/history.svelte.ts`).
- localStorage corruption → fallback to default and repair; storage blocked → view state is a no-op (`src/lib/localStorage.js`, `src/lib/stores/pages.svelte.ts`).
- Adapter migration failure → logs and exits; legacy data is never deleted unless `config.*` is populated (`main.js`).

## Cross-Cutting Concerns

**Logging:** `console.*` in the browser (`console.warn` for recoverable, `console.error` for data/socket failures); `this.log.info/warn` in `main.js`. No logging library.

**Validation:** Shape-validating parsers per document (`parsePageRegistry`, `parseTemplateRegistry`, `parseRegistry`, `migrateLibrary`), placement/group/page validators in `pages-ops.ts`, `parseLayoutRef` for handoffs, `parseDoc` for the envelope.

**Authentication:** None in the app; ioBroker's web adapter/broker session governs access. The socket handshake emits only `name` with the namespace.

**Theming:** CSS custom properties in `src/app.css`; `dark` class on `<html>`; persisted under `__VISUAL__:theme`; pre-paint script in `src/app.html` avoids a flash; `applyTheme` also updates `meta[theme-color]`.

**Localization:** Document names are plain strings; ioBroker object names may be `{lang: text}` and are resolved via `localizeName` (`src/lib/config/format.ts`). UI strings are English-only.

**Icons:** Material Symbols names or image URLs; image detection/ownership in `src/lib/config/icon-ops.ts`, URL resolution in `src/lib/utils/icon-url.ts`, glyph rendering in `src/lib/components/common/Icon.svelte`.

**Layout metrics:** The single home of breakpoint numbers is `BREAKPOINTS` in `src/lib/config/size-ops.ts`; components emit them as `--tile-w`/`--tile-h` CSS variables.

---

*Architecture analysis: 2026-10-22*
