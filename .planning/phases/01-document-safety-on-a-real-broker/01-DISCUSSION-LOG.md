# Phase 1: Document safety on a real broker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-22
**Phase:** 1-Document safety on a real broker
**Areas discussed:** Second tab

---

## Second tab

| Option | Description | Selected |
|--------|-------------|----------|
| Last-write-wins, prove it | No new coordination; prove the existing inbound `onUpdate` replace + echo suppression + the pre-load write guard with a store test. Accepts that two writes in the same 250 ms window lose the earlier one. | ✓ (after reframing, see notes) |
| Stale-write warning | A tab broadcasts each save on a BroadcastChannel; a tab that sees a foreign write while holding an unflushed edit warns "another tab changed this document" and disables write until reload. | |
| Ownership lock | First tab claims the document (BroadcastChannel + heartbeat); other tabs get a read-only editor. | |

**User's choice:** Reframed the area (free-text) — it is not one browser tab but all clients converging
on the broker: the broker is the single source of truth, and every client *and the adapter* applies a
change it is affected by. Explicitly named all four documents (deviceList, UI tree, formulaList,
templateList). Follow-up decision: **(a)** accept the ~250 ms concurrent-write window and document it as
a known limit.

**Notes:**
- User's words: "if somebody change the device list other instances should see this change immediately,
  if somebody change the UI tree, then the trees for the others should change also like for the formula
  and template lists."
- User's framing of the contract: "whatever one client submits the adapter and the other clients
  execute."
- Investigation during the discussion found the propagation already implemented for all four
  documents (`st.onUpdate` + `lastSent` echo suppression + debounced `setState` in
  `pages.svelte.ts`, `templates.svelte.ts`, `registry.svelte.js`, `formulas.svelte.js`), so the phase's
  job is to prove it, not build it.
- The user's answer also described an adapter that runs configurable ioBroker state logic and per-user
  configuration security; both were flagged as out of scope for this phase and recorded as deferred
  ideas.

| Option | Description | Selected |
|--------|-------------|----------|
| Apply immediately, everywhere | An inbound change replaces the model and an open editor re-renders against the newer document. No draft state. | ✓ |
| Open editor keeps its draft | The open editor holds its draft and the inbound document is applied on close, with the commit applied on top of the newer document. | |

**User's choice:** Apply immediately, everywhere.
**Notes:** Matches what the code does today (`st.onUpdate` replaces the model).

---

## the agent's Discretion

- Test shape for the four convergence paths (one test per document vs a shared harness) and where the
  echo-suppression assertion lives.
- Where the `www/` drift guard runs (PERSIST-05): Vitest rebuild-and-diff, a CI hash manifest, or an
  `npm run pack` precondition.
- How the migration logic becomes unit-testable (PERSIST-04): extract to a pure module under
  `src/lib/config/`, or test through mocha with a mocked adapter.
- Dropped-socket UX and retry (PERSIST-02): where "not saved" surfaces and whether a failed edit is
  queued for reconnect or dropped.

These four gray areas were presented but not selected for discussion; they are open for the planner.

## Deferred Ideas

- Adapter runtime logic driven by config ("the main adapter will run ioBroker state logic which will be
  configured and managed by a to-be-implemented UI config page/s") — the adapter-logic stream, already
  recorded as v2/unspecified in PROJECT.md and STATE.md.
- Per-user security so only special users may configure UI or adapter logic — after main functionality.
- Conflict detection / document-version rebase — the alternative to the accepted concurrent-write
  window.
