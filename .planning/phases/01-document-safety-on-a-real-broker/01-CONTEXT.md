# Phase 1: Document safety on a real broker - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove — not rebuild — the guards that keep an operator's document from being lost, and prove that a
change submitted by any client converges on every other client.

In scope:
- Store-level tests for the guarded write paths and the four documents' inbound-change handling
  (PERSIST-01, PERSIST-02, PERSIST-03)
- A unit-testable path for the adapter's legacy-copy / placeholder logic (PERSIST-04)
- A drift guard that reports a committed `www/` that no longer matches a build of `src/` (PERSIST-05)
- A documented, tested statement of the accepted concurrency limit

Out of scope for this phase: any new UI capability, adapter runtime behaviour beyond `mode: "once"`,
conflict detection, per-user access control.

</domain>

<decisions>
## Implementation Decisions

### Cross-client convergence (the "second tab" area)
- **D-01:** The broker is the single source of truth and every client applies an inbound change it is
  affected by. This already holds for all four documents — `src/lib/stores/pages.svelte.ts`,
  `src/lib/stores/templates.svelte.ts`, `src/lib/registry.svelte.js` (deviceList) and
  `src/lib/formulas.svelte.js` (formulaList) each set `st.onUpdate` on their state, replace the
  in-memory model, suppress their own echo by comparing the serialized document to `lastSent`, and
  write back through a debounced `setState`. Phase 1 **proves** this, document by document; it does
  not build it.
- **D-02:** Convergence is required for **all four** documents — deviceList, the display tree
  (`pageList`), `templateList` and `formulaList` — not only `pageList`. The user's framing: "if
  somebody change the device list other instances should see this change immediately, if somebody
  change the UI tree, then the trees for the others should change also like for the formula and
  template lists."
- **D-03:** Two clients writing inside the same ~250 ms debounce window is an **accepted, documented
  limit**: the later `setState` wins and the earlier edit is lost silently. No conflict detection, no
  `updatedAt`-based rebase, no detection channel. The phase records it as a known limit (in the
  phase's docs and, as a product statement, among PROJECT.md's constraints).
  — **Reversibility:** costly — adding detection later means a document-version field in the
  persisted shape plus a rebase path in every writer.
- **D-04:** An inbound change from another client applies **immediately, everywhere**: an open tile
  editor or device form re-renders against the newer document instead of holding a draft. No
  draft/rebase path in any editor.
  — **Reversibility:** costly — adding draft protection later touches every editor that can write.

### the agent's Discretion
- **Test shape** for the four convergence paths — one test per document or a shared harness — and
  where the echo-suppression assertion lives. The existing conventions apply: co-located
  `<module>.test.ts`, `expect.requireAssertions`, injected fakes rather than module mocks (except the
  `$lib/ioBrokerConnect.svelte.js` singleton, which `pages.svelte.ts` imports directly).
- **Where the `www/` drift guard runs** (PERSIST-05) — a Vitest test that rebuilds and diffs, a hash
  manifest checked in CI, or a precondition inside `npm run pack`. Not discussed; the trade-off is
  blocking the release versus warning about it.
- **How the migration logic becomes unit-testable** (PERSIST-04) — extracting the copy/placeholder
  logic out of `main.js` into a pure module (the `src/lib/config/` layer is where pure, testable
  domain logic already lives) versus testing it through mocha with a mocked adapter. Not discussed.
- **Dropped-socket UX and retry** (PERSIST-02) — where "not saved" surfaces (sheet banner, tile-line
  badge, toast) and whether a failed edit is queued for reconnect or dropped. Not discussed. Grounding
  for the planner: `savePages()` currently sets `saveFailed = true` and returns without sending when
  `!ioBroker.connected`, so today the edit is dropped; `getLayoutSaveFailed()` already exposes the
  state for the UI, and `commitLayout()` returns `false` only when the document was never loaded.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition and requirements
- `.planning/ROADMAP.md` §"Phase 1: Document safety on a real broker" — goal, the 5 success criteria
  this phase is measured against
- `.planning/REQUIREMENTS.md` §"Document safety" — PERSIST-01 … PERSIST-05, the checkable requirements
- `.planning/PROJECT.md` — constraints (testing, deployment/`www/`, layering, HMR), the incidents that
  shape this phase, the Key Decisions table
- `.planning/STATE.md` — current blockers for this phase

### Design contracts and ingested intel
- `.planning/intel/constraints.md` — the A-numbered design contracts; the display spec's write
  discipline / HMR / error-handling entry governs the write path this phase proves
- `.planning/intel/SYNTHESIS.md` — the supersession chain ("read before touching the UI") and the
  status note that `.planning/codebase/` is ground truth for what exists
- `.planning/INGEST-CONFLICTS.md` — the 11 auto-resolved conflicts; relevant here are the two
  SPEC-over-DOC resolutions

### Codebase grounding
- `.planning/codebase/TESTING.md` — framework, injected-fake pattern, coverage gaps ("the persistence
  layer and the migration in `main.js` are the highest-risk untested paths")
- `.planning/codebase/CONCERNS.md` — Tech Debt, Fragile Areas (document migration paths, committed
  `www/`), Test Coverage Gaps
- `.planning/codebase/ARCHITECTURE.md` — the boot/hydration path and the store write path
- `.planning/codebase/STRUCTURE.md` — where pure logic, stores and tests live
- `docs/progress/handoff-2026-10-22-iobroker-visual-adapter.md` — the two overwrite incidents, the
  live-broker context, and the gates at that handoff

### Source files this phase touches
- `src/lib/config/pages-ops.ts` — `mayWritePages`, `loadPages`, `parsePageRegistry`,
  `migratePageRegistry` (the guard and the pure document logic)
- `src/lib/stores/pages.svelte.ts` — `initPages` (inbound `onUpdate`), `savePages` (debounce,
  `saveFailed`, disconnect drop), `commitLayout` (the only write path), `migrateLayout`
- `src/lib/stores/templates.svelte.ts`, `src/lib/registry.svelte.js`, `src/lib/formulas.svelte.js` —
  the other three documents' propagation and write paths
- `main.js` — `DOCS` list, legacy copy, placeholder detection (the migration to make testable)
- `test/package.js`, `test/integration.js` — the mocha layer the migration test may join
- `vite.config.mjs` — the Vitest `include` pattern a new test must fit
- `.github/workflows/test-and-release.yml` — where a drift guard would run in CI

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mayWritePages` (`src/lib/config/pages-ops.ts`) — the guard to prove; `commitLayout` already routes
  every editor write through it
- `getLayoutSaveFailed()` / `saveFailed` (`src/lib/stores/pages.svelte.ts`) — the "not saved" state
  already exists for the UI to read; PERSIST-02 needs the retry half
- `setObjectSource` / `setStateSource` / `setCanonicalRegistry` (`src/lib/stores/devices.test.ts`) —
  the injection pattern for testing module-level runes state
- `fakeClient()` recording writes (`src/lib/utils/control-write.test.ts`) — the shape to copy for a
  `setState` spy
- `vi.waitFor` polling (`src/lib/stores/history.test.ts`) — the async-store assertion pattern
- `vi.mock("$lib/ioBrokerConnect.svelte.js")` (`src/lib/picker-values.test.ts`) — required where a
  module imports the socket singleton directly, as `pages.svelte.ts` does

### Established Patterns
- Co-located `<module>.test.ts`; flat `it()` or `describe()` groups; `expect.requireAssertions: true`
  means a test without an assertion fails
- Inject fakes, do not mock modules — the singleton is the single exception
- `@iobroker/testing` for package and integration layers; the Vitest `include` deliberately excludes
  `test/`
- Timers via `vi.useFakeTimers()` (`src/lib/utils/debounce.test.ts`) — the debounce in `savePages` is
  the same shape

### Integration Points
- `src/lib/config/pages-ops.ts` is the existing home for pure document logic — the natural place for
  any migration helper extracted from `main.js`
- `vite.config.mjs` `test.include` (`src/**/*.{test,spec}.{js,ts}`) constrains where a new Vitest test
  can live; a repo-root drift test would need the mocha layer or a config change
- `.github/workflows/test-and-release.yml` (`check-and-lint`, `adapter-tests`) is the CI surface a
  drift guard would hook into

</code_context>

<specifics>
## Specific Ideas

- The propagation contract in the user's words: "whatever one client submits the adapter and the other
  clients execute."
- Named examples: a deviceList change must be visible in other instances immediately; the UI tree,
  formula list and template list behave the same way.
- The adapter itself is a client of these documents in the user's mental model — it should apply a
  change it is affected by (this is what the deferred adapter-logic stream would make real).

</specifics>

<deferred>
## Deferred Ideas

- **Adapter runtime logic driven by config** — "the main adapter will run ioBroker state logic which
  will be configured and managed by a to-be-implemented UI config page/s similar to the current
  visualization configuration." This is the adapter-logic stream; `PROJECT.md` and `STATE.md` already
  record it as deferred to v2 because it is still unspecified, and the current adapter is
  `mode: "once"` (creates the four documents, exits) so it has no runtime behaviour to configure yet.
- **Per-user security** — "we may add later security by user so only special users may configure UI or
  adapter logic, but this should go after main functionality is implemented." Explicitly post-v1.
- **Conflict detection / document-version rebase** — the alternative to D-03; revisit if the accepted
  window bites in practice.

</deferred>

---

*Phase: 1-Document safety on a real broker*
*Context gathered: 2026-10-22*
