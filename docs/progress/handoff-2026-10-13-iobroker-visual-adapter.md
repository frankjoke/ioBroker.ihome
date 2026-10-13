# Handoff — ioBroker Visual Interface adapter

**Date:** 2026-10-13
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Session focus:** Built **history controls** — read ioBroker history for a state-backed
control, with a backwards duration and a granularity. Merged to `main`. User smoke-tested
in the browser: works.

## State of the codebase

- Branch `main`, **no remote**. The history merge is committed; the two same-day
  follow-ups below (history "…" fix + device-row age) are **uncommitted** in the
  working tree.
- This session's work: branch `feature/history-controls` → merged (`--no-ff`).
- Spec/plan:
  - `docs/superpowers/specs/2026-10-13-history-controls-design.md`
  - `docs/superpowers/plans/2026-10-13-history-controls.md`
- Knowledge graph refreshed (`graphify update .`).
- `npm test` **180 passed (15 files)**, `npm run lint` clean, `npm run check` 0/0,
  `npm run build` writes `www/`.

## What was built — history controls

History is an **optional property of an existing state control** (`Control.history`),
not a new control kind. The control's own `stateId` is the series.

- **Model** (`src/lib/types/device.ts`): `HistorySpec { duration, durationUnit: "hours"|"days",
  count?, step?, stepUnit?, aggregate? }`, `Control.history?`. `project.ts` persists it.
- **Pure module** `src/lib/config/history-ops.ts`: `historyEnabled` (any `common.custom`
  entry with `enabled !== false`), `durationMs`/`stepMs`, `historyKey`, `buildHistoryOptions`
  (`count` wins over `step`; step → `aggregate`), `toSeries` (reduces to `{ts,val}` only),
  `summarize`, `trimSeries`, `appendLive`, `sparklinePoints`, `durationLabel`,
  `granularityLabel`.
- **Store** `src/lib/stores/history.svelte.ts`: lazy fetch keyed by `stateId+spec`, caches
  `{status, series, fetchedAt}`; `ensureHistory` / `refreshHistory` / `readHistory` (pure) /
  `noteLive` (persists live samples). Broker access is **injected** via
  `setHistoryClient(ioBroker)` from `+layout.svelte` (keeps the store testable; the store
  never imports the socket module).
- **UI**: `HistoryEditor.svelte` (modal: duration + unit, samples, interval + step unit +
  aggregate, live preview sparkline, Refresh/Remove/Cancel/Save; preview fetch debounced);
  `HistorySummary.svelte` (one line: label, `last 24h · 200 samples`, count, min–max,
  sparkline, refresh). Rendered inside `ControlRow.svelte` right after the Label/Unit line;
  also on each `/devices` page row. A history icon button (state controls with
  `historyEnabled`) opens the modal.
- **Loading**: full range fetched when the row first renders, then **live appends** as the
  state changes (no refetch); manual refresh re-fetches.

## Two real bugs found and fixed during smoke testing (both on `main`)

1. **`getHistory` response shape** (`9757828`). The socket callback is
   `(err, rows, step, sessionId)` — `rows` is the **array itself**, not `{ result: [...] }`.
   `toSeries` was reading `result.result` → always `[]` → "no data". Fixed to accept the bare
   array (wrapper kept as fallback). Verified against the live broker (200 rows → 200 points).
2. **Sparkline invisible** (`9b7ad1b`). `stroke: var(--primary)` — the token is
   `--primary-color`, so the declaration was invalid and the polyline had no stroke. Now
   `stroke: currentColor` + `color: var(--primary-color)`, so it degrades to the text colour
   instead of vanishing.

## Review (fresh reviewer subagent, whole branch)

Verdict "With fixes": 0 Critical, 4 Important (all fixed, each with a failing test first),
5 Minor (deferred). Fixed: live appends now persist; editor preview fetch debounced;
store made injectable + tested (empty/error/disconnected/`{ts,val}`-only); live-append trim
is bounded by the **window** (plus a hard 2000-point cap), never by `count`, so the
"last Nh" label stays honest. New tests: `history-ops`, `history` store, `utils/debounce`.

## Open items / follow-ups

- **Deferred minors (from the review):** `noteLive` has no `Number.isFinite` guard of its own
  (call sites guard); store error text uses `String(e)` → can render `"[object Object]"`;
  the module-level history cache never evicts; the editor does not clamp a negative
  duration/step.
- **`VirtualEditor.svelte`** has the same pre-existing `var(--primary)` typo (its active tint
  won't show) — untouched.
- **Charting** is still not built (spec non-goal); the sparkline is inline SVG, not a chart.
  "Display both histories in one chart" was the original intent — a natural next feature.
- **Earlier still-open items** (from the 2026-10-11 handoff): formula seed-on-empty decision;
  `applyTemplate` clearing `unit`; template `<select>` race; unguarded `migrateLibrary`;
  `initFormulas` no-retry; Settings modal title flip; `addFormula` unused; switch-widget
  hardcoded `"On"/"Off"`; possibly-dead root `verify.js`.
- **No remote** — nothing pushed.

## Environment notes

- Windows, bash shell. Prefer `C:\Users\franz\AppData\Local\Temp\opencode`.
- The user **always has the dev server running** (`npm run dev`, vite on 5173) and watches
  edits live — do not start a competing dev server; do not drive Playwright unless asked.
- ioBroker: host `iobroker` / `192.168.178.9`, admin port **8081** (the app connects there).
  `web.0` 8082, `socketio.0` 8084.
- **Debugging tip:** Node 24 is available, so a throwaway `.mjs` can drive the broker
  directly — `globalThis.location = {href:...}` then dynamic-import
  `src/lib/iobroker.socket.io.js`, `client.connect("ws://192.168.178.9:8081/socket.io", …)`,
  `client.emit("name","admin.0")`, then `client.emit("getHistory", id, opts, cb)`. This is how
  the response-shape bug was found. (`.ts` modules import fine in Node 24 via type stripping.)
- Tests: Vitest, node env, `requireAssertions: true`; files at
  `src/**/*.{test,spec}.{js,ts}`. Svelte 5 runes + TypeScript in new components; no new deps.

## Follow-up fix (same day) — history summaries stuck on "…"

**Symptom:** after the merge, every history summary (device list + control rows)
showed `…` forever; the editor preview stuck on "loading…". Manual Refresh did
nothing.

**Root cause (not a logic bug):** Vite dev-server HMR gave the *same* store
module two different `?t=` cache-bust hashes after the merge, so
`/src/lib/stores/history.svelte.ts?t=A` (imported by `+layout.svelte`) and
`…?t=B` (imported by `HistorySummary`/`HistoryEditor`) became **two separate
module instances**. `setHistoryClient(ioBroker)` populated the layout's copy;
the components called `ensureHistory` on their copy where `client` was `null`,
so `ensureHistory` always early-returned and the cache never filled → `…`.
Production is unaffected (Rollup dedupes). Verified live: injecting the client
into the components' instance made the first summary render `195 pts`.

**Fix:** removed the module-global client entirely. `ensureHistory`/
`refreshHistory` now take the `HistoryClient` as their first argument; the two
components pass the shared `ioBroker` they already import. Dropped
`setHistoryClient` and the `+layout.svelte` call; tests pass the fake client
directly. This is immune to HMR module duplication and needs no dev-server
restart.

**Also:** `stores/devices.svelte.ts` has the same latent pattern
(`setStateSource`/`setObjectSource` module globals injected by the layout). It
is *not* currently desynced (live values render), so it was left alone — but a
future HMR of that store could reproduce the same class of bug there.

**Checks:** `npm test` 180 passed (15 files); `npm run check` 0/0;
`npm run lint` clean; `npm run build` OK (writes `www/`). Graph refreshed.

## Follow-up feature (same day) — device row shows how long since last update

**Ask:** for each device list entry, after the control values, show how long ago
the device last reported — to spot a dead device vs. a switch that was just
toggled.

**Built (one file, `src/routes/devices/+page.svelte`):**

- `lastUpdate(device)` — newest `ts` across the device's **state-backed**
  controls (`ioBroker.states.get(stateId)?.ts`); virtual controls have no state
  and don't contribute.
- Rendered after `{summaries(d)}` in the device-meta line: a clock icon
  (`material-symbols-outlined` → `schedule`, `aria-hidden`) followed by
  `agoLabel` → `17s ago` / `26m ago` / `2d ago`, or `just now` for the `<4s`
  bucket. `title` shows the absolute time. Nothing renders when no control has a
  timestamp.
- Reuses `formatAge()` from `lib/config/format.ts`. No new deps, no new
  component.

**Deliberate limits:** `ts` (last *update*) was chosen over `lc` (last value
*change*) — a sensor posting readings keeps it fresh, which is the "is it
delivering data" signal. The age does **not** tick on a timer; it refreshes on
the next state change, same as the live values.

**Checks:** `npm run check` 0/0; `npm run lint` clean; `npm test` 180 passed;
graph refreshed. Verified live in the browser (all 10 rows).

## Open items for next session

- Commit the two same-day follow-ups (history "…" fix + device-row age).
- Optional: harden `stores/devices.svelte.ts` the same way (drop the
  `setStateSource`/`setObjectSource` module globals) — the latent twin of the
  history bug.
- Optional: make the device-row age tick on a timer instead of on state change.
- Earlier still-open items (from the 2026-10-11 handoff): formula seed-on-empty
  decision; `applyTemplate` clearing `unit`; template `<select>` race; unguarded
  `migrateLibrary`; `initFormulas` no-retry; Settings modal title flip;
  `addFormula` unused; switch-widget hardcoded `"On"/"Off"`; possibly-dead root
  `verify.js`.
