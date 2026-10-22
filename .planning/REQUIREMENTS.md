# Requirements: iHome

**Defined:** 2026-10-22
**Core Value:** An operator's dashboard on a real broker: the tiles render live device state, an edit
made in the UI persists to the broker, and a document is never lost.

**Provenance:** no PRD was ingested, so no requirement IDs came from the docs. These are derived from
the remaining work: the sources' own open items (`.planning/intel/SYNTHESIS.md` → "Open items carried
from the sources"), the codebase concerns (`.planning/codebase/CONCERNS.md`), and the last handoff's
open items (`docs/progress/handoff-2026-10-22-iobroker-visual-adapter.md`). Everything the 11 specs
describe has landed and is listed as Validated in `PROJECT.md`.

## v1 Requirements

### Document safety

- [ ] **PERSIST-01**: Loading the dashboard against an absent or unparsable document never writes to
  the broker — the seeded display stays in memory and the state is left exactly as it was
- [ ] **PERSIST-02**: A failed or disconnected save shows "not saved" in the editor, and the edit
  reaches the broker on the next change or reconnect — the stored document always equals the last
  successful save, never an empty one
- [ ] **PERSIST-03**: The store write paths (`pages`, `templates`, `formulas`, `sheet`) are covered by
  unit tests: commit refusal before a successful load, debounce, echo suppression, failure handling
- [ ] **PERSIST-04**: The adapter's legacy-copy / placeholder logic is unit-tested through a pure
  helper — a tile-less seed counts as empty, and legacy `0_userdata.0.Test.AiHome.*` data is never
  deleted while `config.*` is empty
- [ ] **PERSIST-05**: A stale `www/` cannot be committed unnoticed — the build/pack path reports when
  the committed bundle no longer matches `src/`

### Installation and lifecycle

- [ ] **INSTALL-01**: The packaged adapter installs on a broker that has never seen iHome; starting
  `ihome.0` creates the four `config.*` JSON states, runs the legacy migration once, and exits cleanly
  (`mode: "once"`)
- [ ] **INSTALL-02**: The installed adapter object's version equals the shipped package version — no
  stale version is left behind in admin
- [ ] **INSTALL-03**: The dashboard is reachable at `/ihome/index.html` on that clean broker, renders
  the seeded display, and the admin link card opens it
- [ ] **INSTALL-04**: `npm run deploy:www` redeploys the UI to a running broker without an adapter
  install, and the served `_app/version.json` matches the local build
- [ ] **INSTALL-05**: CI is green on the pushed commit — check + lint, and the adapter tests on
  Node 22.x and 24.x
- [ ] **INSTALL-06**: `engines.node` matches the actual toolchain floor (Vite 7 / Vitest 4), and the
  vendored WebSocket client records its upstream version plus a re-vendor procedure

### History and charts

- [ ] **HIST-01**: An operator can configure history on a control in the device editor, enable the
  sparkline on a value slot, and see the chart on the tile and in the detail row
- [ ] **HIST-02**: Series are shared per state id — two tiles charting one state cause one
  `getHistory` fetch and one cache entry
- [ ] **HIST-03**: A history list can be collapsed to one line and expanded again
- [ ] **HIST-04**: Clicking a sparkline opens a larger chart of the same series

### Editor completeness

- [ ] **EDIT-01**: A slot can read another device (`Slot.from`) — the slot editor offers a device
  pick, and the tile renders that device's live value
- [ ] **EDIT-02**: User templates can be listed, renamed and deleted outside a tile; a tile whose
  template is deleted still renders from the chain
- [ ] **EDIT-03**: The sheet's tile line shows the tile's position so ↑/↓ has visible feedback
- [ ] **EDIT-04**: The tile editor's field groups fold to one line and expand on demand (A49)

### Release

- [ ] **REL-01**: A release bumps the version, writes the changelog and tags the commit through the
  release script, with `npm test` green on the tag
- [ ] **REL-02**: The adapter is published to npm and accepted into `ioBroker/ioBroker.repositories`,
  so it installs from the admin's adapter list

## v2 Requirements

Deferred — tracked, not in this roadmap.

### Performance

- **PERF-01**: Subscriptions are scoped to used states instead of `subscribe *` + `getAllObjects` at
  boot; picker objects load on demand
- **PERF-02**: First paint and memory stay bounded on a large installation (tens of thousands of
  objects)

### Model

- **VIRT-01**: A virtual control may reference another virtual control, with ordered evaluation and
  cycle detection (v1 excludes it)
- **ADAPTER-01**: The adapter-logic stream — what the adapter should do beyond owning the documents
  (handoff 2026-10-22, still unspecified)

### Quality

- **TEST-01**: A component/E2E layer for the SPA (39 `.svelte` files currently have no tests)
- **QUAL-01**: Coverage tooling (`@vitest/coverage-v8`) and a threshold
- **QUAL-02**: `tools.svelte.js` and `localStorage.js` ported to typed `.svelte.ts` (15 suppression
  sites)
- **SEC-01**: The `new Function` trust boundary documented in `docs/`

## Out of Scope

| Feature | Reason |
|---------|--------|
| Absolute placement, drag-and-drop canvas, per-group backgrounds | No absolute placement exists anywhere in the model; sections flow from the available width (A13) |
| A charting engine — axes, tooltips, zoom, crosshair, tile legend | The chart is a per-value-slot SVG sparkline, normalised per series (A59–A63) |
| Icon upload / data-URLs written into the document | Icons stay one raw string resolved at render (A23, A66) |
| vis-2 export, adapter rename, remote push, animations beyond a static glow | Stated non-goals of the display spec; repo/package identity is settled |
| Server-side computation for virtual states | Evaluation stays client-side over the device-state pool |
| App-level authentication | The broker / `web` adapter owns access; the SPA is served from the broker origin |
| A component/E2E test framework for the SPA | The suite is Vitest in a node env with `requireAssertions`; UI is verified by a browser smoke pass |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERSIST-01 | Phase 1 | Pending |
| PERSIST-02 | Phase 1 | Pending |
| PERSIST-03 | Phase 1 | Pending |
| PERSIST-04 | Phase 1 | Pending |
| PERSIST-05 | Phase 1 | Pending |
| INSTALL-01 | Phase 2 | Pending |
| INSTALL-02 | Phase 2 | Pending |
| INSTALL-03 | Phase 2 | Pending |
| INSTALL-04 | Phase 2 | Pending |
| INSTALL-05 | Phase 2 | Pending |
| INSTALL-06 | Phase 2 | Pending |
| HIST-01 | Phase 3 | Pending |
| HIST-02 | Phase 3 | Pending |
| HIST-03 | Phase 3 | Pending |
| HIST-04 | Phase 3 | Pending |
| EDIT-01 | Phase 4 | Pending |
| EDIT-02 | Phase 4 | Pending |
| EDIT-03 | Phase 4 | Pending |
| EDIT-04 | Phase 4 | Pending |
| REL-01 | Phase 5 | Pending |
| REL-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-10-22*
*Last updated: 2026-10-22 after roadmap creation*
