# History Controls — Design Spec

- **Date:** 2026-10-13
- **Status:** Draft (awaiting review)
- **Topic:** Read ioBroker history for a state-backed control: define granularity
  (samples / interval) and a backwards duration, fetch the series lazily, keep it
  current by appending live updates, and show a summary + sparkline in the device
  config list and the devices page.

## 1. Goal

A device control that already points at an ioBroker state which has history
attached should be able to **read that history** and let the user define *how much*
and *how finely*:

- **Duration** — how far back: `last N hours` or `last N days` (hours and days only;
  this is not for fast-changing data).
- **Granularity** — either a **sample count** (`count`) or an **interval + aggregate**
  (`step` + `aggregate`). If both are given, **count wins**.

The result is reduced to **timestamp + value pairs only** — no `from`, `ack`, `q`,
or any other ioBroker history metadata is retained.

Motivating example: a thermometer whose `temperature` and `humidity` states both have
history. Each control gets its own history config; later both series can be drawn in
one chart.

### Non-goals
- No charting in this iteration. The sparkline is a compact inline SVG, not a chart.
- No history for virtual controls (no `stateId`).
- No server-side aggregation beyond what the ioBroker `getHistory` call performs.
- No new runtime dependencies.
- No write-back to history.

## 2. Data model (`src/lib/types/device.ts`)

History is an **optional property of an existing state control**, not a new control
`kind`. A history belongs to a state, so the binding is the control's own `stateId`;
a separate control row would duplicate `stateId`/label/unit and could dangle.

```ts
export type HistoryDurationUnit = "hours" | "days";
export type HistoryAggregate =
  | "average" | "min" | "max" | "total" | "count" | "none" | "onchange";

export interface HistorySpec {
  duration: number;                    // e.g. 24
  durationUnit: HistoryDurationUnit;   // "hours" | "days"
  count?: number;                      // samples; if set, wins over step
  step?: number;                       // bucket size, paired with stepUnit
  stepUnit?: "seconds" | "minutes" | "hours";
  aggregate?: HistoryAggregate;        // used with step
}

export interface Control {
  id: string;
  kind?: "state" | "virtual";          // unchanged
  feature: string;
  stateId?: string;
  writable: boolean;
  label?: string;
  unit?: string;
  hidden?: boolean;
  transform?: Transform;
  virtual?: VirtualSpec;
  formulaId?: string;
  history?: HistorySpec;               // NEW — only meaningful on a state-backed control
  common?: ControlCommon;
}
```

`projectControl` (`src/lib/config/project.ts`) gains `history: c.history` so it is
persisted and enriched extras are still dropped.

**`EnrichedControl` is unchanged.** Enrichment (`devices.svelte.ts`) is synchronous
and history is asynchronous; the history store owns the fetched data, and the UI reads
the store directly rather than through enrichment.

## 3. Pure module (`src/lib/config/history-ops.ts`, new)

Pure and testable; mirrors the existing `virtual-ops.ts` / `runStep` style.

- `historyEnabled(obj)` → `boolean`. `true` when `obj.common.custom` has at least one
  entry whose `enabled !== false`. This is the cheap, generic check that decides
  whether the history button is offered. (Actual data is confirmed by a real fetch —
  see §5.)
- `durationMs(spec)` → number. `hours → 3600_000`, `days → 86_400_000`.
- `historyKey(stateId, spec)` → string. Stable cache key from `stateId` + the spec
  fields (duration, unit, count, step, stepUnit, aggregate).
- `buildHistoryOptions(spec, now = Date.now())` → ioBroker `getHistory` options:
  `{ start: now - durationMs, end: now, ignoreNull: true }`, then
  - if `count` is set → add `{ count }` (and no `step`);
  - else if `step` is set → add `{ step: stepMs, aggregate: spec.aggregate ?? "average" }`.
- `toSeries(result)` → `{ ts: number; val: number }[]`. Reads `result.result`,
  keeps only entries with a finite numeric `val` and numeric `ts`, maps to
  `{ ts, val }` (dropping every other field), sorts by `ts` and de-dupes equal `ts`.
- `summarize(series)` → `{ count: number; min?: number; max?: number }`.
- `trimSeries(series, { windowMs, count?, stepMs?, now })` → the incremental-append
  helper: drop points older than `now - windowMs`; when downsampling, keep at most the
  newest `count` points, or `ceil(windowMs / stepMs)` when `step` is set.
- `sparklinePoints(series, width, height, pad)` → SVG polyline `points` string.
  Handles 0 points (`""`), 1 point (flat line), and a flat series (mid-line).

## 4. Store (`src/lib/stores/history.svelte.ts`, new)

Reactive store, mirroring the existing store pattern (no import of the socket module —
the live state cache is injected with the existing `setStateSource`).

- `Map<historyKey, Entry>` held in `$state`; `Entry =
  { status: "loading" | "ready" | "empty" | "error"; series: {ts,val}[]; fetchedAt: number; error?: string }`.
- `ensureHistory(stateId, spec)` — fetch once if the key is absent (via
  `ioBroker.getHistory`), calling `buildHistoryOptions` + `toSeries`. Empty result ⇒
  `status: "empty"`.
- `refreshHistory(stateId, spec)` — re-fetch the whole range for that key.
- `getHistory(stateId, spec)` — returns the current entry; if the live state's `ts` is
  newer than the last cached point, appends that single `{ts, val}` and runs
  `trimSeries`, so the series stays current **without refetching** and without
  duplicating on repeat renders.
- No timers, no prefetch: only keys that a rendered row/modal asks for are fetched,
  and live appends stop when nothing reads the store.

## 5. UI

**`ControlRow.svelte`** — a history icon button beside the transform button:
- Rendered/enabled only when the control has a `stateId` **and**
  `historyEnabled(ioBroker.objects.get(stateId))`.
- Highlighted when `control.history` is set; click opens `HistoryEditor`.

**`HistoryEditor.svelte` (new modal)** — edits a local draft, Cancel | Save (same
pattern as `VirtualEditor`):
- **Duration:** number input + unit select (hours | days).
- **Granularity:** `count` (samples) and `step` + `stepUnit` + `aggregate` select, with
  a hint that **count wins when both are set**.
- **Live preview:** sparkline + point count + min/max from `ensureHistory`; an empty
  result shows "no data in range". This is also where real data availability is
  confirmed.
- **Refresh**, **Cancel | Save**.

**`HistorySummary.svelte` (new)** — one summary line per history-enabled control:
label, `last 24h · 200 samples`, point count, min/max and an inline sparkline. Calls
`ensureHistory`, so it self-loads on first render and self-updates via live appends.

**`DeviceForm.svelte`** — after the control list, render a `HistorySummary` per
history-enabled control (the summary line at the end of the device's control list).

**`src/routes/devices/+page.svelte`** — render the same `HistorySummary` lines inside
each device row, so devices that are not being edited show their history summaries too.

## 6. Migration

None required. `history` absent ⇒ no history; existing registries load unchanged and
new history config is additive.

## 7. Testing

Vitest unit tests (`src/lib/config/history-ops.test.ts`):
- `historyEnabled` — enabled entry, `enabled: false`, no `custom`.
- `durationMs` — hours and days.
- `buildHistoryOptions` — count wins over step; step converted to ms; aggregate
  default; `start`/`end` from `now`.
- `toSeries` — drops non-numeric values and all extra fields, sorts, de-dupes.
- `summarize` — count/min/max; empty series.
- `trimSeries` — window cut, count cap, step-window cap.
- `sparklinePoints` — 0 / 1 / flat / normal series.

The store stays thin (fetch + call the pure helpers); `project.test.ts` gains a
round-trip case for `history`.

Manual: enable history on a thermometer's temperature control, open the modal, watch
the preview, save, confirm the summary line renders in the editor and on the devices
page, and confirm it grows as the value changes.

## 8. Files

**New**
- `src/lib/config/history-ops.ts` + `src/lib/config/history-ops.test.ts`
- `src/lib/stores/history.svelte.ts`
- `src/lib/components/config/HistoryEditor.svelte`
- `src/lib/components/config/HistorySummary.svelte`

**Edit**
- `src/lib/types/device.ts` — `HistorySpec`, `Control.history?`.
- `src/lib/config/project.ts` (+ `project.test.ts`) — persist `history`.
- `src/lib/components/config/ControlRow.svelte` — history button + modal mount.
- `src/lib/components/config/DeviceForm.svelte` — summary lines after the controls.
- `src/routes/devices/+page.svelte` — summary lines in each device row.

All new/edited Svelte components use Svelte 5 runes and TypeScript; no new runtime deps.

## 9. Open questions / decisions

### Decisions
- Binding: **property of an existing state control** (`Control.history`), not a new
  control kind; the control's own `stateId` is the series.
- Availability: offer the button when `common.custom` has an enabled entry; **confirm
  real data with a `getHistory` fetch** in the modal / summary line.
- Duration units: **hours and days** only.
- Granularity: **both `count` and `step`+`aggregate` fields; count wins when set**.
- Data shape: **`{ ts, val }` pairs only**.
- Loading: **lazy** — fetch the full range when a history row/modal first renders,
  then **append live updates** instead of refetching; manual refresh re-fetches.
- Display: summary + inline sparkline **both in the editor and on the devices page**.

### Open questions
- Should a history line be collapsible/hidden by default once there are many? Defer
  until it looks crowded.
- Should the sparkline be clickable to open a full chart later? Out of scope here.
