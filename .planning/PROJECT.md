# iHome

## What This Is

iHome is an ioBroker adapter plus a static Svelte 5 SPA that gives one household a single operator
dashboard over the broker: a tile grid of the broker's devices, a layout sheet for arranging it, and
device-level editors for controls, transforms, formulas and history. The adapter (`iobroker.ihome`,
`main.js`, `mode: "once"`) creates and owns four JSON documents in `ihome.0.config.*` and exits; the
SPA is served by the ioBroker `web` adapter at `/ihome/` and talks to the broker directly over its
WebSocket, so the broker is the database.

- **Package**: `iobroker.ihome` · **repo**: `iobroker-visual-adapter`
- **Runtimes**: ioBroker js-controller `>= 6.0.11` (live broker 7.2.5) + an evergreen browser (the
  SPA is a hash-routed PWA; no service worker on plain-HTTP LAN origins)
- **Brownfield**: the 22 ingested docs in `docs/superpowers/` (2026-10-09 → 2026-10-21) are the
  design/plan record and have landed. `.planning/codebase/` (mapped at `7af86a1`, 2026-10-22) is
  ground truth for what exists; the specs' own "Status: proposed" lines are historical.

## Core Value

An operator's dashboard on a real broker: the tiles render live device state, an edit made in the UI
persists to the broker, and a document is never lost.

## Requirements

### Validated

Shipped and confirmed on a real broker (repo `main`, adapter 0.0.1 → 0.0.10):

- ✓ Device config UI — device/control schema, feature table, per-direction transform engine, state
  picker (`src/lib/config/`, `/#/devices`)
- ✓ Virtual controls + formula library with five seed templates
- ✓ History controls — spec on the control, read contract, cache store, editor modal, summary line
- ✓ Display — pages/groups/tiles/slots, module grid with breakpoint clamp, rules, badges, chart layer
- ✓ Layout editor as a **mode of the display** (A43–A50), not a route
- ✓ Tile editor — materialisation (A18), per-slot descriptors (`Slot.icon`, `Slot.spark`, `Slot.where`)
- ✓ Slot icons (A51–A58) and slot sparklines (A59–A64); legacy `icon`/`sparkline` kinds retired
- ✓ Device icons resolved from the broker hierarchy (`objectIcon`, `iconSrc` URL contract)
- ✓ Adapter packaging — once-mode lifecycle, `config.*` states, legacy migration, committed `www/`,
  CI workflow, `npm run pack`, `npm run deploy:www` over the broker's MCP endpoint

### Active

This roadmap (see `.planning/REQUIREMENTS.md` for the checkable list):

- [ ] Document safety on a real broker — guards proven, migration tested, `www/` drift caught (Phase 1)
- [ ] Clean-broker install and instance lifecycle verified (Phase 2)
- [ ] History and charts finished at operator scale (Phase 3)
- [ ] The editor's deferred capabilities — cross-device slots, template library, tile position (Phase 4)
- [ ] Release path — npm publish + `ioBroker.repositories` (Phase 5)

### Out of Scope

| Feature | Reason |
|---------|--------|
| Absolute placement, drag-and-drop canvas, per-group backgrounds | No absolute placement exists anywhere in the model; sections flow from the available width (A13) |
| A charting engine — axes, tooltips, zoom, crosshair, tile legend | The chart is a per-value-slot SVG sparkline, normalised per series (A59–A63) |
| Icon upload / data-URLs written into the document | Icons stay one raw string resolved at render time (A23, A66) |
| vis-2 export, adapter rename, remote push, animations beyond a static glow | Stated non-goals of the display spec; the repo/package identity is settled |
| Server-side computation for virtual states | Evaluation stays client-side over the device-state pool (v1 limit) |
| App-level authentication | The broker/`web` adapter owns access; the SPA is served from the broker origin |
| A component/E2E test framework for the SPA | The suite is Vitest in a node env with `requireAssertions`; UI is verified by a browser smoke pass at phone/tablet/desktop |

## Context

**Live broker (last handoff, 2026-10-22):** `192.168.178.9` — js-controller 7.2.5, Node 24.19.0,
`web` 9.1.16, adapter object 0.0.9 with the 0.0.10 SPA deployed live. Dashboard at
`http://192.168.178.9:8082/ihome/index.html`. `ihome.0.config.pageList` holds 3 pages / 26 tiles,
`deviceList` 12 devices, `templateList` empty; the legacy `0_userdata.0.Test.AiHome.*` originals are
kept as a backup.

**Gates at that handoff:** `npm test` 391/391 (33 files) · `npm run check` 0 · `npm run lint` 0 ·
`npm run build` green · `test:package` 46/46.

**Incidents that shape Phase 1:** the SPA seeded an empty `pageList` when it could not read one and
(until 0.0.4) saved it — it overwrote the migrated documents twice and they had to be restored by
hand. The guard exists now (`mayWritePages`: only a `loaded` or `seeded` document may be replaced),
but it has no store-level test.

**Untested high-risk paths:** `stores/pages.svelte.ts` / `stores/templates.svelte.ts` write paths
(debounced writes and guarded commits can drop or corrupt document edits), `main.js`
migration/placeholder logic, and all 39 `.svelte` files.

**Supersession chain — read before touching the UI:** the editor is a mode of the display, not a
route (A43); `SlotKind` = `value | level | color | enum | button | badge | history-list | frame`
(`icon`/`sparkline` retired by A56/A59, `frame` added by A38); a tile is materialised iff it has
`slots` (A18); per-slot descriptors are the pattern (A51, A59); the chart is per value slot (A59/A61);
history stays configured per control in the device editor. Full transcription:
`.planning/intel/constraints.md`.

**Open item with no owner yet:** "the adapter-logic stream" — what the adapter should do beyond
owning the documents (handoff 2026-10-22). Deferred to v2 until requirements exist.

## Constraints

- **Tech stack**: exactly one runtime dependency (`@iobroker/adapter-core`); the SPA stays a static
  build. No new runtime dependency without a reason.
- **Rendering**: static SPA only (`adapter-static`, `fallback: "index.html"`, `strict: true`); no
  server routes, no `+page.server.ts`.
- **Routing**: hash router; production `paths.base = "/ihome"`; components take `base` from
  `$app/paths`, never a hardcoded `/ihome`.
- **Persistence**: ioBroker states are the database — four `ihome.0.config.*` JSON documents. No
  external DB, no server-side code.
- **Layering**: `src/lib/config/**` (pure domain) must not import stores, components or the socket;
  UI calls pure `*-ops.ts` functions and commits through a store write path.
- **HMR**: never hold a module-global socket client in a reusable module — import the shared
  `ioBroker` rune or take a minimal client interface (`WriteClient`, `HistoryClient`); handoffs that
  cross a navigation use sessionStorage.
- **Trust boundary**: document content (expressions compiled with `new Function`, icon URLs) is
  locally authored and privileged; the ioBroker ACL governs who can write those states.
- **Deployment**: `www/` is committed because GitHub installs do not build the frontend, so it must
  be rebuilt before committing UI changes; `npm run pack` ships the tarball; `npm run deploy:www`
  uploads the UI over the broker's MCP endpoint.
- **Testing**: Vitest (`environment: "node"`, `expect.requireAssertions: true`, no DOM/component
  tests) plus mocha `test/package.js` and `test/integration.js` (needs a real js-controller). Every
  change passes `npm run lint`, `npm run check`, `npm test`.
- **Success metric (developer-facing)**: a working adapter on a real broker — phases are measured by
  what an operator can do with the installed adapter (dashboard renders, edits persist,
  history/sparklines work), not by doc coverage.

## Key Decisions

**No ADR was ingested and no doc is marked `locked`** — nothing in this project is an ADR lock. The
A-numbered decisions below are design contracts from the SPEC series; the full transcription (A1–A71
plus the plain "Decisions" lists) lives in `.planning/intel/constraints.md`.

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| The editor is a mode of the display, not a route (A43) | Entering the editor must not navigate; the display behind is the same instance, and the cursor's page is the display's page | ✓ Good |
| `SlotKind` loses `icon`/`sparkline`, gains `frame` (A38, A56, A59) | Per-slot descriptors replaced whole kinds; a frame reads a page, not a control | ✓ Good |
| A tile is materialised iff it has `slots`; the first edit writes a complete `{template, size, slots}` (A18) | Ends the partial-`size` contradiction; Reset drops `tile` entirely | ✓ Good |
| Documents are shape-validated and never overwritten on an unreadable read | A bad read means "not loaded yet", not "the user wants this" — one write can destroy the operator's config | ✓ Good |
| History is a property of a state control, not a new control kind | A history belongs to a state, so the binding is the control's own `stateId` | ✓ Good |
| The display only ever moves on the broker's word (`setState`, then `stateChange`) | One write path; no component writes the live cache | ✓ Good |
| Virtual states are client-side over the device-state pool, with no dependency resolution (v1) | Avoids cycles and a server-side compute layer | ⚠️ Revisit — ordered evaluation + cycle detection is deferred to v2 |
| `www/` is committed and shipped in the package | GitHub installs do not run a frontend build | ⚠️ Revisit — it can silently drift from `src/` (Phase 1 adds the guard) |
| WebSocket client `@iobroker/ws` (published) instead of `socket.io-client` | It speaks the raw ioBroker protocol against `…/socket.io` | ✅ Replaced — the hand-vendored v3.0.4 copy became the published upstream `@iobroker/ws` on 2026-10-22 (quick task `261022-up1`); the transport conclusion (raw ioBroker protocol, not `socket.io-client`) still holds |

---
*Last updated: 2026-10-22 after ingesting the 22-doc design record and mapping the codebase*
