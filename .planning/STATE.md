---
gsd_state_version: "1.0"
milestone: v1.0
milestone_name: Adapter on a real broker
current_phase: 1
current_phase_name: Document safety on a real broker
status: planning
stopped_at: Phase 1 context gathered
last_updated: "2026-10-22T20:28:34.571Z"
last_activity: 2026-10-22
last_activity_desc: ingested the 22-doc design record, mapped the codebase, wrote PROJECT/REQUIREMENTS/ROADMAP
state_head: 30e31361773b3a1e71a647c917f0421768ff79b9
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-22)

**Core value:** An operator's dashboard on a real broker — tiles render live state, edits persist, a document is never lost.
**Current focus:** Phase 1 — Document safety on a real broker

## Current Position

Phase: 1 of 5 (Document safety on a real broker)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-10-22 — ingested the 22-doc design record, mapped the codebase, wrote PROJECT/REQUIREMENTS/ROADMAP

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (design contracts from the SPEC series; no ADR locks exist).
Recent decisions affecting current work:

- Roadmap derived from what remains, not from the docs: the 11 specs have landed (codebase map, commit 7af86a1)
- Doc status lines ("Status: proposed", unchecked plan boxes) are historical — `.planning/codebase/` is ground truth
- The adapter-logic stream ("what the adapter does beyond owning documents") is deferred to v2 — still unspecified

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: `stores/pages.svelte.ts` / `stores/templates.svelte.ts` write paths and `main.js` migration logic have no unit tests (highest-risk untested paths — they write user config)
- Phase 2: CI workflow is committed but its first run is unverified; the installed adapter object is 0.0.9 while the shipped package is 0.0.10
- Phase 5: `ioBroker.repositories` acceptance is an external manual review — not fully under our control
- All phases: `www/` is committed and can silently lag `src/` (Phase 1 adds the drift guard)
- Quick task 261022-up1 merged to `main` (`a2e4dda`, fast-forward) and confirmed working on the real broker (ioBroker-served load at `192.168.178.9:8082/ihome/`); the branch was deleted. Still unexercised: the `FALLBACK_BROKER` path for a locally started PWA (`npm run preview`, H1) — do that before advertising local start.
- Quick task 261022-up1 shipped a version bump: `package.json` and `io-package.json` are now `0.0.11` from a manual test build, not from `npm run release` — no tag, no changelog beyond the `news` block. Phase 5 must expect `0.0.11` as the already-shipped version.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 261022-up1 | Replace the vendored ioBroker WebSocket client with the published @iobroker/ws client, keeping the configurable broker-address fallback | 2026-10-22 | 30e3136 | Verified on broker | [261022-up1-replace-the-vendored-iobroker-websocket-](./quick/261022-up1-replace-the-vendored-iobroker-websocket-/) |

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Model | Virtual controls referencing other virtual controls (ordered eval + cycle detection) | Deferred | 2026-10-22 | v2 |
| Performance | Subscription scoping / on-demand object loading for large installations | Deferred | 2026-10-22 | v2 |
| Quality | Component/E2E test layer, coverage tooling, typed port of `tools.svelte.js` | Deferred | 2026-10-22 | v2 |
| Scope | The adapter-logic stream (unspecified next feature work) | Deferred | 2026-10-22 | v2 |

## Session Continuity

Last session: 2026-10-22
Stopped at: Quick task 261022-up1 merged to main (a2e4dda) and confirmed on the real broker; suite green (unit 399, package 46, integration 1)
Resume file: .planning/quick/261022-up1-replace-the-vendored-iobroker-websocket-/261022-up1-SUMMARY.md
