# History Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a state-backed device control read ioBroker history for its state — with a backwards duration (hours/days) and a granularity (sample count, or interval + aggregate) — and show a summary line with point count, min/max and a sparkline in the device config list and the devices page.

**Architecture:** History is an **optional property** (`Control.history`) of an existing state control, not a new control kind; the control's own `stateId` is the series. A pure module (`config/history-ops.ts`) builds the `getHistory` options, reduces the response to `{ ts, val }` pairs, summarizes, trims and draws a sparkline. A store (`stores/history.svelte.ts`) fetches each spec lazily on first render and then appends live updates instead of refetching. A `HistoryEditor` modal configures it; a `HistorySummary` line renders it in the editor and on the devices page.

**Tech Stack:** Svelte 5 (runes) + TypeScript, Vitest, Vite/SvelteKit. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-10-13-history-controls-design.md`

## Global Constraints

- Svelte 5 runes + TypeScript in all new/edited components; **no new runtime dependencies**.
- History data is reduced to **`{ ts, val }` pairs only** — never retain `from`, `ack`, `q` or any other ioBroker history field.
- The read path **never throws**: a failed `getHistory` becomes a store entry with `status: "error"` and a message.
- `Control.history` is only meaningful on a control with a `stateId`; virtual controls (no `stateId`) never get one.
- Back-compat: `history` absent ⇒ no history; existing registries load unchanged.
- Tests: Vitest, node env, `requireAssertions: true`, files at `src/**/*.{test,spec}.{js,ts}` (colocated `*.test.ts`).
- Formatter/lint: Prettier (2-space, double quotes) + ESLint; run `npm run lint`.
- Verification commands: `npm test`, `npm run lint`, `npm run check`, `npm run build`.
- Platform: Windows + bash; scratch files under `C:\Users\franz\AppData\Local\Temp\opencode`.

## Review Focus

Input classes / failure modes the spec implies but no single task's happy path covers — each has a pinning test in its owning task:

1. A history-enabled state whose range holds **no points** → store `status: "empty"`, summary shows "no data", sparkline `""`, no crash. (Task 2, Task 4)
2. `getHistory` **fails** (adapter offline / no permission) → store `status: "error"` with a message, no crash, no retry storm. (Task 4)
3. `count` **and** `step` both set → `count` wins; also step-only, count-only, and neither. (Task 1)
4. A live update that is **older or equal** to the last point, or non-numeric → not appended, no duplicate. (Task 2 `appendLive`, Task 4)
5. A state object whose `common.custom` entries are all `enabled: false` → history button **not** offered. (Task 1 `historyEnabled`)

---

### Task 1: Model + history-ops read core

**Files:**
- Modify: `src/lib/types/device.ts`
- Create: `src/lib/config/history-ops.ts`
- Test: `src/lib/config/history-ops.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HistoryDurationUnit = "hours" | "days"`, `HistoryAggregate = "average" | "min" | "max" | "total" | "count" | "none" | "onchange"`
  - `HistorySpec { duration: number; durationUnit: HistoryDurationUnit; count?: number; step?: number; stepUnit?: "seconds" | "minutes" | "hours"; aggregate?: HistoryAggregate }`
  - `Control.history?: HistorySpec`
  - `HistoryPoint { ts: number; val: number }`
  - `historyEnabled(obj: any): boolean`
  - `durationMs(spec: HistorySpec): number`
  - `stepMs(spec: HistorySpec): number | undefined`
  - `historyKey(stateId: string, spec: HistorySpec): string`
  - `buildHistoryOptions(spec: HistorySpec, now?: number): Record<string, unknown>`
  - `toSeries(result: any): HistoryPoint[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/config/history-ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  historyEnabled,
  durationMs,
  stepMs,
  historyKey,
  buildHistoryOptions,
  toSeries,
  type HistorySpec,
} from "$lib/config/history-ops";

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("historyEnabled", () => {
  it("is true when a custom entry is enabled", () => {
    expect(
      historyEnabled({ common: { custom: { "history.0": { enabled: true } } } }),
    ).toBe(true);
  });
  it("is true when a custom entry omits enabled (only false disables)", () => {
    expect(historyEnabled({ common: { custom: { "sql.0": {} } } })).toBe(true);
  });
  it("is false when every custom entry is disabled", () => {
    expect(
      historyEnabled({ common: { custom: { "history.0": { enabled: false } } } }),
    ).toBe(false);
  });
  it("is false without custom or object", () => {
    expect(historyEnabled({ common: {} })).toBe(false);
    expect(historyEnabled(undefined)).toBe(false);
  });
});

describe("durationMs / stepMs", () => {
  it("converts hours and days", () => {
    expect(durationMs({ duration: 24, durationUnit: "hours" })).toBe(24 * HOUR);
    expect(durationMs({ duration: 2, durationUnit: "days" })).toBe(2 * DAY);
  });
  it("converts the step unit and returns undefined when absent", () => {
    expect(
      stepMs({ duration: 1, durationUnit: "hours", step: 30, stepUnit: "minutes" }),
    ).toBe(1_800_000);
    expect(
      stepMs({ duration: 1, durationUnit: "hours", step: 45, stepUnit: "seconds" }),
    ).toBe(45_000);
    expect(stepMs({ duration: 1, durationUnit: "hours" })).toBeUndefined();
  });
});

describe("historyKey", () => {
  it("is stable and changes with the spec", () => {
    const a: HistorySpec = { duration: 24, durationUnit: "hours", count: 200 };
    const b: HistorySpec = { duration: 24, durationUnit: "hours", count: 100 };
    expect(historyKey("s", a)).toBe(historyKey("s", a));
    expect(historyKey("s", a)).not.toBe(historyKey("s", b));
    expect(historyKey("s", a)).not.toBe(historyKey("t", a));
  });
});

describe("buildHistoryOptions", () => {
  const now = 1_000_000_000_000;
  it("uses count when set", () => {
    expect(
      buildHistoryOptions({ duration: 24, durationUnit: "hours", count: 200 }, now),
    ).toEqual({ start: now - 24 * HOUR, end: now, ignoreNull: true, count: 200 });
  });
  it("uses step + aggregate when only step is set", () => {
    expect(
      buildHistoryOptions(
        {
          duration: 2,
          durationUnit: "days",
          step: 30,
          stepUnit: "minutes",
          aggregate: "max",
        },
        now,
      ),
    ).toEqual({
      start: now - 2 * DAY,
      end: now,
      ignoreNull: true,
      step: 1_800_000,
      aggregate: "max",
    });
  });
  it("count wins when both are set", () => {
    expect(
      buildHistoryOptions(
        {
          duration: 1,
          durationUnit: "hours",
          count: 10,
          step: 60,
          stepUnit: "minutes",
          aggregate: "min",
        },
        now,
      ),
    ).toEqual({ start: now - HOUR, end: now, ignoreNull: true, count: 10 });
  });
  it("raw when neither is set", () => {
    expect(buildHistoryOptions({ duration: 1, durationUnit: "hours" }, now)).toEqual(
      { start: now - HOUR, end: now, ignoreNull: true },
    );
  });
});

describe("toSeries", () => {
  it("keeps only finite numeric { ts, val }, sorted and de-duped", () => {
    const res = {
      result: [
        { ts: 2, val: 20, from: "a", ack: true },
        { ts: 1, val: 10 },
        { ts: 3, val: "n/a" },
        { ts: 4, val: null },
        { ts: 2, val: 21, q: 1 },
      ],
    };
    expect(toSeries(res)).toEqual([
      { ts: 1, val: 10 },
      { ts: 2, val: 20 },
    ]);
    expect(toSeries(res)[0]).not.toHaveProperty("from");
  });
  it("returns [] for an empty or malformed response", () => {
    expect(toSeries({ result: [] })).toEqual([]);
    expect(toSeries(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/history-ops.test.ts`
Expected: FAIL — cannot resolve `$lib/config/history-ops`.

- [ ] **Step 3: Add the model types**

In `src/lib/types/device.ts`, add above `Control`:

```ts
export type HistoryDurationUnit = "hours" | "days";
export type HistoryAggregate =
  | "average"
  | "min"
  | "max"
  | "total"
  | "count"
  | "none"
  | "onchange";

export interface HistorySpec {
  duration: number;
  durationUnit: HistoryDurationUnit;
  count?: number;
  step?: number;
  stepUnit?: "seconds" | "minutes" | "hours";
  aggregate?: HistoryAggregate;
}
```

Add to `Control` (after `formulaId?`):

```ts
  history?: HistorySpec;
```

- [ ] **Step 4: Implement the read core**

Create `src/lib/config/history-ops.ts` exporting the names in **Interfaces**. Implementation notes:

- `historyEnabled(obj)` → `Object.values(obj?.common?.custom ?? {}).some((e: any) => e?.enabled !== false)`.
- `durationMs` → `duration * (unit === "days" ? 86_400_000 : 3_600_000)`.
- `stepMs` → `undefined` unless `spec.step`; scale by `seconds → 1000`, `minutes → 60_000`, `hours → 3_600_000` (default `minutes`).
- `historyKey` → join `stateId` and every spec field with `|` (stable, e.g. `` `${stateId}|${duration}${durationUnit}|${count ?? ""}|${step ?? ""}${stepUnit ?? ""}|${aggregate ?? ""}` ``).
- `buildHistoryOptions(spec, now = Date.now())` → `{ start: now - durationMs(spec), end: now, ignoreNull: true }`; if `count` → add `count` (do **not** add step); else if `stepMs(spec)` → add `step` and `aggregate: spec.aggregate ?? "average"`.
- `toSeries(result)` → `result?.result` array → keep entries where `typeof val === "number" && Number.isFinite(val)` and `typeof ts === "number"`, map to fresh `{ ts, val }` (dropping every other field), sort by `ts`, drop later duplicates of the same `ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/history-ops.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/device.ts src/lib/config/history-ops.ts src/lib/config/history-ops.test.ts
git commit -m "feat(history): model + getHistory read core"
```

---

### Task 2: Summary, trim, append, sparkline, labels

**Files:**
- Modify: `src/lib/config/history-ops.ts`
- Test: `src/lib/config/history-ops.test.ts`

**Interfaces:**
- Consumes: `HistorySpec`, `HistoryPoint`, `stepMs` (Task 1).
- Produces:
  - `summarize(series: HistoryPoint[]): { count: number; min?: number; max?: number }`
  - `trimSeries(series: HistoryPoint[], opts: { windowMs: number; count?: number; stepMs?: number; now: number }): HistoryPoint[]`
  - `appendLive(series: HistoryPoint[], point: HistoryPoint, spec: HistorySpec, now: number): HistoryPoint[]`
  - `sparklinePoints(series: HistoryPoint[], width: number, height: number, pad?: number): string`
  - `durationLabel(spec: HistorySpec): string`
  - `granularityLabel(spec: HistorySpec): string`

- [ ] **Step 1: Write the failing tests**

Extend the existing import at the top of `src/lib/config/history-ops.test.ts` (one import from the module — `import/no-duplicates` fails lint), then append:

```ts
describe("summarize", () => {
  it("counts and finds min/max", () => {
    expect(summarize([{ ts: 1, val: 10 }, { ts: 2, val: 30 }])).toEqual({
      count: 2,
      min: 10,
      max: 30,
    });
  });
  it("handles an empty series", () => {
    expect(summarize([])).toEqual({ count: 0, min: undefined, max: undefined });
  });
});

describe("trimSeries", () => {
  const now = 100_000;
  const series = [
    { ts: now - 10_000, val: 1 },
    { ts: now - 1_000, val: 2 },
    { ts: now, val: 3 },
  ];
  it("drops points older than the window", () => {
    expect(trimSeries(series, { windowMs: 5_000, now })).toEqual([
      { ts: now - 1_000, val: 2 },
      { ts: now, val: 3 },
    ]);
  });
  it("caps to the newest `count` points", () => {
    expect(trimSeries(series, { windowMs: 60_000, count: 1, now })).toEqual([
      { ts: now, val: 3 },
    ]);
  });
  it("caps to the step window when downsampling", () => {
    expect(trimSeries(series, { windowMs: 60_000, stepMs: 30_000, now })).toEqual([
      { ts: now - 1_000, val: 2 },
      { ts: now, val: 3 },
    ]);
  });
});

describe("appendLive", () => {
  const spec: HistorySpec = { duration: 1, durationUnit: "hours" };
  const now = 100_000;
  it("appends a strictly newer point", () => {
    expect(appendLive([{ ts: 99_000, val: 1 }], { ts: 100_000, val: 2 }, spec, now)).toEqual([
      { ts: 99_000, val: 1 },
      { ts: 100_000, val: 2 },
    ]);
  });
  it("returns the same array for an older or equal point", () => {
    const s = [{ ts: 100_000, val: 1 }];
    expect(appendLive(s, { ts: 100_000, val: 9 }, spec, now)).toBe(s);
    expect(appendLive(s, { ts: 90_000, val: 9 }, spec, now)).toBe(s);
  });
  it("trims to the window while appending", () => {
    const s = [{ ts: now - 2 * 3_600_000, val: 1 }];
    expect(appendLive(s, { ts: now, val: 2 }, spec, now)).toEqual([{ ts: now, val: 2 }]);
  });
});

describe("sparklinePoints", () => {
  it("is empty for no points", () => {
    expect(sparklinePoints([], 100, 20)).toBe("");
  });
  it("draws a flat mid-line for one point or a flat series", () => {
    expect(sparklinePoints([{ ts: 1, val: 5 }], 100, 20, 0)).toBe("0,10 100,10");
    expect(
      sparklinePoints([{ ts: 0, val: 5 }, { ts: 10, val: 5 }], 100, 20, 0),
    ).toBe("0,10 100,10");
  });
  it("maps time to x and value to y (inverted)", () => {
    expect(
      sparklinePoints([{ ts: 0, val: 0 }, { ts: 10, val: 10 }], 100, 20, 0),
    ).toBe("0,20 100,0");
  });
});

describe("labels", () => {
  it("describes the duration", () => {
    expect(durationLabel({ duration: 24, durationUnit: "hours" })).toBe("last 24h");
    expect(durationLabel({ duration: 7, durationUnit: "days" })).toBe("last 7d");
  });
  it("describes the granularity", () => {
    expect(granularityLabel({ duration: 24, durationUnit: "hours", count: 200 })).toBe(
      "200 samples",
    );
    expect(
      granularityLabel({
        duration: 1,
        durationUnit: "hours",
        step: 30,
        stepUnit: "minutes",
        aggregate: "max",
      }),
    ).toBe("30min max");
    expect(granularityLabel({ duration: 1, durationUnit: "hours" })).toBe("raw");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/history-ops.test.ts`
Expected: FAIL — `summarize`/`trimSeries`/`appendLive`/`sparklinePoints`/labels not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/lib/config/history-ops.ts`. Implementation notes:

- `summarize` → empty series ⇒ `{ count: 0, min: undefined, max: undefined }`; else `{ count, min: Math.min(...vals), max: Math.max(...vals) }`.
- `trimSeries` → first drop `ts < now - windowMs`; then cap the newest `opts.count` points when set, else the newest `Math.ceil(windowMs / opts.stepMs)` points when `stepMs` is set. Return the input array unchanged when nothing is dropped (so callers can test identity).
- `appendLive(series, point, spec, now)` → if the last point exists and `point.ts <= last.ts`, return `series` unchanged; otherwise `trimSeries([...series, point], { windowMs: durationMs(spec), count: spec.count, stepMs: stepMs(spec), now })`.
- `sparklinePoints(series, width, height, pad = 0)` → `""` for 0 points; for 1 point or a flat series return the flat mid-line `` `${pad},${height / 2} ${width - pad},${height / 2}` ``; else x = `pad + (i / (n - 1)) * (width - 2 * pad)`, y = `height - pad - ((val - min) / (max - min || 1)) * (height - 2 * pad)`, joined with `" "` (integers are fine — the pinned tests use round numbers).
- `durationLabel(spec)` → `last ${duration}${durationUnit === "days" ? "d" : "h"}`.
- `granularityLabel(spec)` → `count` ⇒ `${count} samples`; else `step` ⇒ `${step}${stepUnit === "seconds" ? "s" : stepUnit === "hours" ? "h" : "min"} ${aggregate ?? "average"}`; else `"raw"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/history-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/history-ops.ts src/lib/config/history-ops.test.ts
git commit -m "feat(history): summary, trim, live append, sparkline, labels"
```

---

### Task 3: Persist the history property

**Files:**
- Modify: `src/lib/config/project.ts`
- Test: `src/lib/config/project.test.ts`

**Interfaces:**
- Consumes: `Control.history` (Task 1).
- Produces: `projectControl` keeps `history`.

- [ ] **Step 1: Update the failing tests**

In `src/lib/config/project.test.ts`, add `history: undefined,` to the expected object in the first test (`"strips non-model fields from a control"`), next to `formulaId: undefined,`. Then add:

```ts
it("keeps history on a projected control", () => {
  const c: any = {
    id: "h",
    feature: "temperature",
    stateId: "a.0.temp",
    writable: false,
    history: { duration: 24, durationUnit: "hours", count: 200 },
    liveValue: 21,
  };
  const out = projectControl(c);
  expect(out.history).toEqual({ duration: 24, durationUnit: "hours", count: 200 });
  expect(out).not.toHaveProperty("liveValue");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: FAIL — `history` not in the projected object.

- [ ] **Step 3: Add the field to `projectControl`**

In `src/lib/config/project.ts`, add `history: c.history,` after `formulaId: c.formulaId,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/project.ts src/lib/config/project.test.ts
git commit -m "feat(history): persist the history property"
```

---

### Task 4: History store

**Files:**
- Create: `src/lib/stores/history.svelte.ts`

**Interfaces:**
- Consumes: `buildHistoryOptions`, `historyKey`, `toSeries`, `appendLive`, `durationMs`, `HistorySpec`, `HistoryPoint` (Tasks 1–2); `ioBroker` from `$lib/ioBrokerConnect.svelte.js`.
- Produces:
  - `HistoryEntry { status: "loading" | "ready" | "empty" | "error"; series: HistoryPoint[]; fetchedAt: number; error?: string }`
  - `ensureHistory(stateId: string, spec: HistorySpec): void`
  - `refreshHistory(stateId: string, spec: HistorySpec): void`
  - `readHistory(stateId: string, spec: HistorySpec): HistoryEntry | undefined`

- [ ] **Step 1: Implement the store**

Create `src/lib/stores/history.svelte.ts`:

- Cache: `const cache = new SvelteMap<string, HistoryEntry>();` (`SvelteMap` from `svelte/reactivity`).
- `ensureHistory(stateId, spec)` → `if (!ioBroker.connected) return;` (reading `ioBroker.connected` inside the caller's `$effect` makes it retry once connected); `const key = historyKey(stateId, spec); if (cache.has(key)) return;` then set `{ status: "loading", series: [], fetchedAt: 0 }` and `void load(key, stateId, spec)`.
- `load(key, stateId, spec)` (module-private, async) → `try { const res = await ioBroker.getHistory(stateId, buildHistoryOptions(spec)); const series = toSeries(res); cache.set(key, { status: series.length ? "ready" : "empty", series, fetchedAt: Date.now() }); } catch (e) { cache.set(key, { status: "error", series: [], fetchedAt: Date.now(), error: e instanceof Error ? e.message : String(e) }); }`.
- `refreshHistory(stateId, spec)` → `if (!ioBroker.connected) return;` set the key back to `loading` and `void load(...)`.
- `readHistory(stateId, spec)` → `const entry = cache.get(historyKey(stateId, spec)); if (!entry) return entry;` then, when `entry.status === "ready"`, read the live state `ioBroker.states?.get(stateId)` and, if `typeof ts === "number" && typeof val === "number"`, compute `const series = appendLive(entry.series, { ts, val }, spec, Date.now());` and return `series === entry.series ? entry : { ...entry, series };`. Otherwise return `entry`. **Pure** — it must not mutate the cache (it runs during render).

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/history.svelte.ts
git commit -m "feat(history): lazy fetch store with live append"
```

---

### Task 5: HistoryEditor modal

**Files:**
- Create: `src/lib/components/config/HistoryEditor.svelte`

**Interfaces:**
- Consumes: `HistorySpec`, `HistoryAggregate`, `durationLabel`, `granularityLabel`, `summarize`, `sparklinePoints` (Tasks 1–2); `ensureHistory`, `readHistory` (Task 4).
- Produces: a modal component with props
  `{ control: Control; onChange: (c: Control) => void; onClose: () => void }`.

- [ ] **Step 1: Implement the component**

Create `src/lib/components/config/HistoryEditor.svelte`. Use the fixed-overlay markup from `common/ConfirmModal.svelte` (backdrop, centred `card`, Esc via `<svelte:window onkeydown>`) and the draft-then-save pattern from `config/VirtualEditor.svelte`.

- Local draft: `let draft = $state<HistorySpec>(control.history ?? { duration: 24, durationUnit: "hours", count: 200 });` (`JSON.parse(JSON.stringify(...))` the initial value so the modal owns it).
- Fields (all write to `draft`):
  - **Duration** — `<input type="number" min="1">` bound to `draft.duration`, plus a `<select>` with `hours` / `days` for `draft.durationUnit`.
  - **Samples** — `<input type="number" min="1">` bound to `draft.count` (empty ⇒ `undefined`). Hint text: *count wins when set*.
  - **Interval** — `<input type="number">` bound to `draft.step` + a `<select>` (`seconds` / `minutes` / `hours`) for `draft.stepUnit` + an aggregate `<select>` (`average`, `min`, `max`, `total`, `count`, `none`, `onchange`) for `draft.aggregate`.
- Preview: `$effect(() => { if (control.stateId) ensureHistory(control.stateId, draft); });` then
  `const entry = $derived(control.stateId ? readHistory(control.stateId, draft) : undefined);`
  `const summary = $derived(entry ? summarize(entry.series) : undefined);`
  `const points = $derived(entry ? sparklinePoints(entry.series, 240, 48, 4) : "");`
  Render an inline `<svg viewBox="0 0 240 48">` with a `<polyline points={points} fill="none" />`, then the status: `loading` ⇒ "loading…", `empty` ⇒ "no data in range", `error` ⇒ `entry.error`, else `${summary.count} points · ${min}–${max}`.
- Buttons: **Refresh** (`refreshHistory(control.stateId, draft)`), **Remove** (only when `control.history` — `onChange({ ...control, history: undefined }); onClose();`), **Cancel** (`onClose()`), **Save** (`onChange({ ...control, history: draft }); onClose();`).

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/config/HistoryEditor.svelte
git commit -m "feat(history): history editor modal"
```

---

### Task 6: History button + summary line in the device editor

**Files:**
- Create: `src/lib/components/config/HistorySummary.svelte`
- Modify: `src/lib/components/config/ControlRow.svelte`
- Modify: `src/lib/components/config/DeviceForm.svelte`

**Interfaces:**
- Consumes: `historyEnabled` (Task 1), `durationLabel`, `granularityLabel`, `summarize`, `sparklinePoints` (Task 2), `ensureHistory`/`readHistory` (Task 4), `HistoryEditor` (Task 5).
- Produces: `HistorySummary` with props `{ control: Control }`; `ControlRow` shows the history button and mounts `HistoryEditor`.

- [ ] **Step 1: Create `HistorySummary.svelte`**

Props `{ control }: { control: Control }`. Derive `const spec = $derived(control.history);`. Guard: render nothing when `!spec || !control.stateId`. Then:
`$effect(() => { if (control.stateId && spec) ensureHistory(control.stateId, spec); });`
`const entry = $derived(control.stateId && spec ? readHistory(control.stateId, spec) : undefined);`
`const summary = $derived(entry ? summarize(entry.series) : undefined);`
`const points = $derived(entry ? sparklinePoints(entry.series, 120, 24, 2) : "");`

Render one compact line: the control `label` (or `feature`), `durationLabel(spec)`, `granularityLabel(spec)`, then `entry.status` — `loading` ⇒ "…", `empty` ⇒ "no data", `error` ⇒ the error, else `${summary.count} pts · ${min}–${max}` with the unit from `control.unit`. Inline `<svg viewBox="0 0 120 24"><polyline points={points} fill="none" /></svg>` when `points`. Add a small refresh icon button calling `refreshHistory(control.stateId, spec)`.

- [ ] **Step 2: Add the history button to `ControlRow.svelte`**

- Import `historyEnabled` and `HistoryEditor`.
- `const canHistory = $derived(!!control.stateId && historyEnabled(ioBroker.objects.get(control.stateId)));`
- `let showHistory = $state(false);`
- In the first `.line`, for the **state** branch (`{:else}`), add before the transform button:

```svelte
      {#if canHistory}
        <button
          type="button"
          class="icon-btn"
          class:active={!!control.history}
          title="History"
          aria-label="History"
          onclick={() => (showHistory = true)}
        >
          <span class="material-symbols-outlined">history</span>
        </button>
      {/if}
```

- At the bottom, after the `showTransform` block, add:

```svelte
  {#if showHistory}
    <HistoryEditor
      {control}
      onChange={(c) => onChange(c)}
      onClose={() => (showHistory = false)}
    />
  {/if}
```

- [ ] **Step 3: Add summary lines to `DeviceForm.svelte`**

Import `HistorySummary`. After the `{#each controls …}` block (inside `.controls`), add:

```svelte
    {#each controls.filter((c) => c.history && c.stateId) as c (c.id)}
      <HistorySummary control={c} />
    {/each}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/config/HistorySummary.svelte src/lib/components/config/ControlRow.svelte src/lib/components/config/DeviceForm.svelte
git commit -m "feat(history): editor button + summary line"
```

---

### Task 7: Summary lines on the devices page

**Files:**
- Modify: `src/routes/devices/+page.svelte`

**Interfaces:**
- Consumes: `HistorySummary` (Task 6).
- Produces: each device row lists its history summaries.

- [ ] **Step 1: Render the summaries in the device row**

Import `HistorySummary` from `$lib/components/config/HistorySummary.svelte`. Inside `.device-main`, after the `.device-meta` span, add:

```svelte
            {#each (d.controls ?? []).filter((c) => c.history && c.stateId) as c (c.id)}
              <HistorySummary control={c} />
            {/each}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/devices/+page.svelte
git commit -m "feat(history): show summaries on the devices page"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all tests pass (existing + the new `history-ops` and `project` tests).

- [ ] **Step 2: Lint, type-check, build**

Run: `npm run lint && npm run check && npm run build`
Expected: lint clean; 0 errors / 0 warnings; build writes `www/`.

- [ ] **Step 3: Manual smoke test (requires a live ioBroker broker with a history adapter)**

Run: `npm run dev`
- Edit a device whose temperature state has history enabled; the **history** button appears next to the transform button.
- Open it: the preview loads a sparkline and a point count. Change duration to `7 days` and confirm it reloads.
- Set a sample count, save, and confirm the summary line appears under the device's controls **and** on the `/devices` page row.
- Confirm the line grows as the state changes (no full reload), and that **Refresh** re-fetches.
- Pick a state with no history enabled: the button is absent.

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 5: Final commit (if the smoke test produced changes)**

```bash
git add -A
git commit -m "test(history): verification pass" || echo "nothing to commit"
```
