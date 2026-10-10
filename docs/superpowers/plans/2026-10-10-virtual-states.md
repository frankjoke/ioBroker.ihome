# Virtual States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only *computed/aggregate* controls ("virtual states") to devices, driven by an editable JavaScript expression over the device's own state values and a helper API over all device-defined states.

**Architecture:** A new `kind: "virtual"` on `Control` (absent ⇒ `"state"`, back-compatible). A pure engine (`config/virtual-ops.ts`) sanitizes labels, builds a variable scope (locals + helpers), and evaluates the expression with `new Function`, returning `{ value, error? }` and never throwing. The existing enrichment in `stores/devices.svelte.ts` builds the device-state pool once per pass and computes each virtual control's `liveValue` / `virtualError`. A `VirtualEditor` gives a live test; the dashboard renders the value.

**Tech Stack:** Svelte 5 (runes) + TypeScript, Vitest, Vite/SvelteKit. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-10-10-virtual-states-design.md`

## Global Constraints

- Svelte 5 runes + TypeScript in all new/edited components; **no new runtime dependencies**.
- Errors **never throw**: virtual evaluation returns `{ value: unknown; error?: string }` (same policy as `config/transform-ops.ts`).
- Back-compat: a control with no `kind` is a `"state"` control; existing registries load unchanged.
- Tests: Vitest, node env, every test has ≥1 assertion, files at `src/**/*.{test,spec}.{js,ts}` (colocated `*.test.ts`).
- Formatter/lint: Prettier (2-space, double quotes) + ESLint; run `npm run lint`.
- Verification commands: `npm test`, `npm run lint`, `npm run check`, `npm run build`.
- Platform: Windows + bash; scratch files under `C:\Users\franz\AppData\Local\Temp\opencode`.

## Review Focus

Input classes / failure modes the spec implies but no single task's happy-path test covers — each has a pinning test in its owning task:

1. A formula naming a sibling state that is unavailable/`undefined` → result `undefined` + error, never a crash. (Task 2)
2. Aggregate over an empty filter set → `count` 0, `sum` 0, `any` false, `all` true, `avg/min/max` `undefined`. (Task 2)
3. Two labels that sanitize to the same identifier → suffixed (`temperature`, `temperature2`); formula resolves the second. (Task 1, Task 2)
4. Non-numeric members in numeric aggregates → no `NaN` leak (numeric strings coerce; non-numeric strings ignored; booleans count as 1/0). (Task 2)
5. Switching a control State↔Virtual and saving → stale `stateId`/`transform`/`virtual` fields are not persisted together incorrectly; virtual fields survive save/reload. (Task 3)

---

### Task 1: Model + engine core

**Files:**
- Modify: `src/lib/types/device.ts`
- Create: `src/lib/config/virtual-ops.ts`
- Test: `src/lib/config/virtual-ops.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `VirtualSpec { expr: string; precision?: number }`
  - `Control.kind?: "state" | "virtual"`, `Control.stateId?`, `Control.virtual?: VirtualSpec` (types only)
  - `sanitizeLabel(label: string | undefined, taken: Set<string>): string`
  - `evaluateVirtual(expr: string, scope: Scope): VirtualResult`
  - `roundValue(v: unknown, precision?: number): unknown`
  - `Scope { locals: Record<string, unknown>; helpers: Record<string, (...args: any[]) => unknown> }`
  - `VirtualResult { value: unknown; error?: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/config/virtual-ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  sanitizeLabel,
  evaluateVirtual,
  roundValue,
} from "$lib/config/virtual-ops";

describe("sanitizeLabel", () => {
  it("lowercases and replaces non-identifier characters", () => {
    expect(sanitizeLabel("Dew Point", new Set())).toBe("dew_point");
  });
  it("suffixes collisions with an index", () => {
    const taken = new Set<string>();
    expect(sanitizeLabel("Temperature", taken)).toBe("temperature");
    expect(sanitizeLabel("Temperature", taken)).toBe("temperature2");
    expect(sanitizeLabel("temperature", taken)).toBe("temperature3");
  });
  it("falls back for an empty label or one starting with a digit", () => {
    expect(sanitizeLabel("", new Set())).toBe("v");
    expect(sanitizeLabel("1st", new Set())).toBe("v_1st");
  });
});

describe("evaluateVirtual", () => {
  it("evaluates an expression against locals", () => {
    const r = evaluateVirtual("temperature - (100 - humidity) / 5", {
      locals: { temperature: 20, humidity: 50 },
      helpers: {},
    });
    expect(r.value).toBe(10);
    expect(r.error).toBeUndefined();
  });
  it("reports a syntax error without throwing", () => {
    const r = evaluateVirtual("1 +", { locals: {}, helpers: {} });
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
  it("reports an unknown variable without throwing", () => {
    const r = evaluateVirtual("nope + 1", { locals: { x: 1 }, helpers: {} });
    expect(r.error).toBeTruthy();
  });
  it("returns an error for an empty expression", () => {
    expect(
      evaluateVirtual("   ", { locals: {}, helpers: {} }).error,
    ).toBeTruthy();
  });
});

describe("roundValue", () => {
  it("rounds numbers to the given precision", () => {
    expect(roundValue(10.129, 2)).toBe(10.13);
  });
  it("passes non-numbers and undefined precision through", () => {
    expect(roundValue("x", 2)).toBe("x");
    expect(roundValue(10.129, undefined)).toBe(10.129);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/virtual-ops.test.ts`
Expected: FAIL — cannot resolve `$lib/config/virtual-ops`.

- [ ] **Step 3: Add the model types**

In `src/lib/types/device.ts`, add above `Control`:

```ts
export interface VirtualSpec {
  expr: string;
  precision?: number;
}
```

Change `Control` to add the discriminant and make `stateId` optional:

```ts
export interface Control {
  id: string;
  kind?: "state" | "virtual"; // absent ⇒ "state" (back-compat)
  feature: string;
  stateId?: string;
  writable: boolean;
  label?: string;
  unit?: string;
  hidden?: boolean;
  transform?: Transform;
  virtual?: VirtualSpec;
  common?: ControlCommon;
}
```

Add to `EnrichedControl`:

```ts
export interface EnrichedControl extends Control {
  liveValue?: any;
  exists: boolean;
  available: boolean;
  displayRoom?: string;
  object?: any;
  widget?: Widget;
  virtualError?: string;
}
```

- [ ] **Step 4: Implement the engine core**

Create `src/lib/config/virtual-ops.ts`:

```ts
import type { VirtualSpec } from "$lib/types/device";

export interface PoolEntry {
  stateId: string;
  value: unknown;
  role?: string;
  room?: string;
  device?: string;
  feature?: string;
  label?: string;
}

export interface Scope {
  locals: Record<string, unknown>;
  helpers: Record<string, (...args: any[]) => unknown>;
}

export interface VirtualResult {
  value: unknown;
  error?: string;
}

/** Turn a human label into a JS identifier; collisions get an index suffix. */
export function sanitizeLabel(label: string | undefined, taken: Set<string>): string {
  let base = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base || /^[0-9]/.test(base)) base = "v_" + base;
  let name = base;
  let i = 2;
  while (taken.has(name)) name = base + i++;
  taken.add(name);
  return name;
}

/** Evaluate a virtual expression with the scope bound; never throws. */
export function evaluateVirtual(expr: string, scope: Scope): VirtualResult {
  if (!expr || !expr.trim()) return { value: undefined, error: "empty expression" };
  try {
    const localNames = Object.keys(scope.locals);
    const helperNames = Object.keys(scope.helpers);
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      ...localNames,
      ...helperNames,
      `"use strict"; return (${expr});`,
    );
    const value = fn(
      ...localNames.map((n) => scope.locals[n]),
      ...helperNames.map((n) => scope.helpers[n]),
    );
    return { value };
  } catch (e) {
    return { value: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Round a numeric result to `precision` decimals; pass other values through. */
export function roundValue(v: unknown, precision?: number): unknown {
  if (typeof v !== "number" || typeof precision !== "number") return v;
  return Number(v.toFixed(precision));
}
```

Note: `sanitizeLabel("")` → base `""` → `"v_" + ""` = `"v_"`, which does not match the test. Fix the fallback so an empty base becomes `"v"`:

```ts
  if (!base) base = "v";
  else if (/^[0-9]/.test(base)) base = "v_" + base;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/virtual-ops.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/device.ts src/lib/config/virtual-ops.ts src/lib/config/virtual-ops.test.ts
git commit -m "feat(virtual): model types + expression engine core"
```

---

### Task 2: Scope builder, helper API, computeVirtual

**Files:**
- Modify: `src/lib/config/virtual-ops.ts`
- Test: `src/lib/config/virtual-ops.test.ts`

**Interfaces:**
- Consumes: `sanitizeLabel`, `evaluateVirtual`, `roundValue`, `PoolEntry`, `Scope`, `VirtualResult` (Task 1).
- Produces:
  - `LocalControl { kind?: "state" | "virtual"; label?: string; feature?: string; liveValue?: unknown }`
  - `Filter { role?: string; room?: string; device?: string; feature?: string; label?: string }`
  - `buildScope(controls: LocalControl[], pool: PoolEntry[]): Scope`
  - `computeVirtual(control: { virtual?: VirtualSpec }, siblings: LocalControl[], pool: PoolEntry[]): VirtualResult`

- [ ] **Step 1: Write the failing tests**

Extend the existing import at the top of `src/lib/config/virtual-ops.test.ts` to also bring in `buildScope`, `computeVirtual`, and `type PoolEntry` (do **not** add a second import from the same module — `import/no-duplicates` will fail lint), then append:

```ts
const pool: PoolEntry[] = [
  { stateId: "a.0.temp", value: 21, role: "value.temperature", room: "Kitchen", device: "Kitchen.Thermometer", feature: "temperature", label: "Temperature" },
  { stateId: "a.0.hum", value: 55, role: "value.humidity", room: "Kitchen", device: "Kitchen.Thermometer", feature: "humidity", label: "Humidity" },
  { stateId: "b.0.bat", value: 15, role: "value.battery", room: "Hall", device: "Hall.Sensor", feature: "battery", label: "Battery" },
  { stateId: "c.0.mot", value: true, role: "sensor.motion", room: "Hall", device: "Hall.Motion", feature: "motion", label: "Motion" },
  { stateId: "d.0.non", value: "n/a", role: "value", room: "Hall", device: "Hall.Sensor", feature: "value", label: "Raw" },
];

const siblings = [
  { kind: "state", label: "Temperature", feature: "temperature", liveValue: 21 },
  { kind: "state", label: "Humidity", feature: "humidity", liveValue: 55 },
];

describe("buildScope", () => {
  it("binds state controls by sanitized label", () => {
    const { locals } = buildScope(siblings, pool);
    expect(locals.temperature).toBe(21);
    expect(locals.humidity).toBe(55);
  });
  it("excludes virtual controls from locals", () => {
    const { locals } = buildScope(
      [...siblings, { kind: "virtual", label: "Dew", feature: "value", liveValue: 9 }],
      pool,
    );
    expect(locals.dew).toBeUndefined();
  });
  it("suffixes colliding labels so both resolve", () => {
    const { locals } = buildScope(
      [
        { kind: "state", label: "Temperature", liveValue: 1 },
        { kind: "state", label: "Temperature", liveValue: 2 },
      ],
      pool,
    );
    expect(locals.temperature).toBe(1);
    expect(locals.temperature2).toBe(2);
  });
});

describe("helpers", () => {
  it("count with a predicate", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.count({ role: "battery" }, (v: number) => v < 20)).toBe(1);
  });
  it("sum / any / all over a filter", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.sum({ feature: "temperature" })).toBe(21);
    expect(helpers.any({ role: "motion" })).toBe(true);
    expect(
      helpers.all({ room: "Kitchen" }, (v: unknown) => typeof v === "number"),
    ).toBe(true);
  });
  it("ignores non-numeric values in numeric aggregates", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.sum({ room: "Hall" })).toBe(15); // battery 15 + motion true(→1?) + "n/a"
  });
  it("get by explicit device + label (case-insensitive label)", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.get({ device: "Kitchen.Thermometer", label: "humidity" })).toBe(55);
  });
  it("device(name) exposes that device's values by sanitized label", () => {
    const { helpers } = buildScope(siblings, pool);
    expect((helpers.device("Kitchen.Thermometer") as any).humidity).toBe(55);
  });
  it("empty-set semantics", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.count({ role: "nope" })).toBe(0);
    expect(helpers.sum({ role: "nope" })).toBe(0);
    expect(helpers.any({ role: "nope" })).toBe(false);
    expect(helpers.all({ role: "nope" })).toBe(true);
    expect(helpers.avg({ role: "nope" })).toBeUndefined();
    expect(helpers.min({ role: "nope" })).toBeUndefined();
    expect(helpers.max({ role: "nope" })).toBeUndefined();
  });
});

describe("computeVirtual", () => {
  it("computes dew point from locals", () => {
    const r = computeVirtual(
      { virtual: { expr: "temperature - (100 - humidity) / 5" } },
      siblings,
      pool,
    );
    expect(r.value).toBe(12);
  });
  it("applies precision", () => {
    const r = computeVirtual(
      { virtual: { expr: "humidity / 7", precision: 2 } },
      siblings,
      pool,
    );
    expect(r.value).toBe(7.86);
  });
  it("reports errors for a bad expression", () => {
    expect(
      computeVirtual({ virtual: { expr: "temperature +" } }, siblings, pool).error,
    ).toBeTruthy();
  });
  it("yields undefined + error when a named sibling is missing", () => {
    const r = computeVirtual(
      { virtual: { expr: "ghost * 2" } },
      siblings,
      pool,
    );
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/virtual-ops.test.ts`
Expected: FAIL — `buildScope`/`computeVirtual` not exported.

- [ ] **Step 3: Implement scope + helpers + computeVirtual**

Add to `src/lib/config/virtual-ops.ts`:

```ts
export interface LocalControl {
  kind?: "state" | "virtual";
  label?: string;
  feature?: string;
  liveValue?: unknown;
}

export interface Filter {
  role?: string;
  room?: string;
  device?: string;
  feature?: string;
  label?: string;
}

/** Match a pool entry against a filter: `role` is a substring, the rest exact. */
function matches(e: PoolEntry, f: Filter): boolean {
  return (
    (!f.role || String(e.role ?? "").includes(f.role)) &&
    (!f.room || e.room === f.room) &&
    (!f.device || e.device === f.device) &&
    (!f.feature || e.feature === f.feature) &&
    (!f.label || String(e.label ?? "").toLowerCase() === f.label.toLowerCase())
  );
}

/** Build the helper API over the device-state pool. */
function makeHelpers(pool: PoolEntry[]): Scope["helpers"] {
  const values = (f: Filter = {}) =>
    pool.filter((e) => matches(e, f)).map((e) => e.value);
  const numbers = (f: Filter = {}) =>
    values(f)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
  return {
    values,
    count: (f: Filter = {}, pred?: (v: unknown) => boolean) => {
      const vs = values(f);
      return pred ? vs.filter(pred).length : vs.length;
    },
    sum: (f: Filter = {}) => values(f).reduce((a, b) => a + (Number(b) || 0), 0),
    avg: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : undefined;
    },
    min: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? Math.min(...ns) : undefined;
    },
    max: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? Math.max(...ns) : undefined;
    },
    any: (f: Filter = {}, pred?: (v: unknown) => boolean) =>
      values(f).some((v) => (pred ? pred(v) : !!v)),
    all: (f: Filter = {}, pred?: (v: unknown) => boolean) => {
      const vs = values(f);
      return vs.length ? vs.every((v) => (pred ? pred(v) : !!v)) : true;
    },
    get: (ref: string | { device?: string; label?: string }) => {
      if (typeof ref === "string") {
        return pool.find((e) => e.stateId === ref)?.value;
      }
      const hit = pool.find(
        (e) =>
          (!ref.device || e.device === ref.device) &&
          (!ref.label ||
            String(e.label ?? "").toLowerCase() === ref.label.toLowerCase()),
      );
      return hit?.value;
    },
    device: (name: string) => {
      const out: Record<string, unknown> = {};
      const taken = new Set<string>();
      for (const e of pool.filter((x) => x.device === name)) {
        out[sanitizeLabel(e.label || e.feature, taken)] = e.value;
      }
      return out;
    },
  };
}

/** Locals from the device's state controls + helpers over the pool. */
export function buildScope(controls: LocalControl[], pool: PoolEntry[]): Scope {
  const taken = new Set<string>();
  const locals: Record<string, unknown> = {};
  for (const c of controls) {
    if (c.kind === "virtual") continue;
    locals[sanitizeLabel(c.label || c.feature, taken)] = c.liveValue;
  }
  return { locals, helpers: makeHelpers(pool) };
}

/** Compute a virtual control's value (rounding applied); never throws. */
export function computeVirtual(
  control: { virtual?: VirtualSpec },
  siblings: LocalControl[],
  pool: PoolEntry[],
): VirtualResult {
  const { value, error } = evaluateVirtual(
    control.virtual?.expr ?? "",
    buildScope(siblings, pool),
  );
  if (error) return { value: undefined, error };
  return { value: roundValue(value, control.virtual?.precision) };
}
```

Note on `sum({ room: "Hall" })`: members are battery `15`, motion `true`, raw `"n/a"`. `Number(true)=1`, `Number("n/a")=NaN`. The implementation's `sum` uses `Number(b) || 0` per value, so `"n/a"`→0 and `true`→1 → 16. Adjust the test expectation to `16` and its comment, OR change `sum` to ignore non-numeric. **Decision:** keep `sum` simple (`Number(b) || 0`, booleans count as 1/0) and set the test to expect `16`. Update the test line to `expect(helpers.sum({ room: "Hall" })).toBe(16);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/virtual-ops.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/virtual-ops.ts src/lib/config/virtual-ops.test.ts
git commit -m "feat(virtual): scope builder, helper API, computeVirtual"
```

---

### Task 3: Persist virtual fields

**Files:**
- Modify: `src/lib/config/project.ts`
- Test: `src/lib/config/project.test.ts`

**Interfaces:**
- Consumes: `Control.kind`, `Control.virtual` (Task 1).
- Produces: `projectControl` / `projectDevice` keep `kind` and `virtual`.

- [ ] **Step 1: Update the failing tests**

In `src/lib/config/project.test.ts`, change the first test's expected object to include the new fields:

```ts
  expect(out).toEqual({
    id: "c",
    feature: "power",
    stateId: "a.0.b",
    kind: undefined,
    virtual: undefined,
    writable: true,
    label: undefined,
    unit: undefined,
    hidden: undefined,
    transform: undefined,
  });
```

Add a new test:

```ts
it("keeps kind and virtual on a projected virtual control", () => {
  const c: any = {
    id: "v",
    kind: "virtual",
    feature: "value",
    writable: false,
    label: "Dew point",
    virtual: { expr: "temperature - 5", precision: 1 },
    liveValue: 9,
    widget: "value",
  };
  const out = projectControl(c);
  expect(out.kind).toBe("virtual");
  expect(out.virtual).toEqual({ expr: "temperature - 5", precision: 1 });
  expect(out).not.toHaveProperty("liveValue");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: FAIL — `kind`/`virtual` not in the projected object.

- [ ] **Step 3: Add the fields to `projectControl`**

In `src/lib/config/project.ts`:

```ts
export function projectControl(c: Control): Control {
  return {
    id: c.id,
    kind: c.kind,
    feature: c.feature,
    stateId: c.stateId,
    writable: c.writable,
    label: c.label,
    unit: c.unit,
    hidden: c.hidden,
    transform: c.transform,
    virtual: c.virtual,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/project.ts src/lib/config/project.test.ts
git commit -m "feat(virtual): persist kind and virtual fields"
```

---

### Task 4: Enrich virtual controls in the store

**Files:**
- Modify: `src/lib/stores/devices.svelte.ts`

**Interfaces:**
- Consumes: `computeVirtual`, `PoolEntry` (Task 2).
- Produces: `getVirtualPool(): PoolEntry[]`; `EnrichedControl.liveValue/virtualError/widget` set for virtual controls.

- [ ] **Step 1: Add the pool builder**

In `src/lib/stores/devices.svelte.ts`, import the engine and add, above `_devicesEnriched`:

```ts
import { computeVirtual, type PoolEntry } from "$lib/config/virtual-ops";
```

```ts
/** Every state referenced by a device, with its live value and metadata. */
function buildVirtualPool(): PoolEntry[] {
  const pool: PoolEntry[] = [];
  for (const device of canonicalRegistry.devices ?? []) {
    for (const control of device.controls ?? []) {
      if (!control.stateId) continue;
      const st: any = stateSource?.get(control.stateId);
      const obj: any = objectSource?.get(control.stateId);
      pool.push({
        stateId: control.stateId,
        value: applyRead(st?.val, control.transform),
        role: obj?.common?.role,
        room: device.room ?? obj?.common?.room,
        device: device.name,
        feature: control.feature,
        label: control.label ?? control.feature,
      });
    }
  }
  return pool;
}

export function getVirtualPool(): PoolEntry[] {
  return buildVirtualPool();
}
```

- [ ] **Step 2: Compute virtual controls in `_devicesEnriched`**

Change the body so the pool is built once, state controls are enriched first, then virtual controls are computed from the enriched siblings:

```ts
function _devicesEnriched(): EnrichedDevice[] {
  const pool = buildVirtualPool();
  const result = (canonicalRegistry.devices ?? []).map((device) => {
    const controls: EnrichedControl[] = (device.controls ?? []).map(
      (control: Control) => {
        const st: any = stateSource?.get(control.stateId);
        const obj: any = objectSource?.get(control.stateId);
        const liveValue =
          st !== undefined ? applyRead(st.val, control.transform) : undefined;
        return {
          ...control,
          liveValue,
          available: st !== undefined || obj !== undefined,
          exists: obj !== undefined,
          displayRoom: device.room ?? obj?.common?.room ?? undefined,
          object: obj,
          widget: widgetFor(device.type, control.feature),
        };
      },
    );
    for (const c of controls) {
      if (c.kind === "virtual") {
        const { value, error } = computeVirtual(c, controls, pool);
        c.liveValue = value;
        c.virtualError = error;
        c.available = true;
        c.exists = true;
        c.displayRoom = device.room ?? c.displayRoom;
        c.widget = "value";
      }
    }
    const deviceDisplayRoom =
      device.room ?? controls.find((c) => c.displayRoom)?.displayRoom;
    return { ...device, controls, displayRoom: deviceDisplayRoom };
  });
  return result as EnrichedDevice[];
}
export const getDevicesEnriched = _devicesEnriched;
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/devices.svelte.ts
git commit -m "feat(virtual): compute virtual controls during enrichment"
```

---

### Task 5: VirtualEditor component

**Files:**
- Create: `src/lib/components/config/VirtualEditor.svelte`

**Interfaces:**
- Consumes: `sanitizeLabel`, `computeVirtual`, `getVirtualPool` (Tasks 1–4).
- Produces: a component with props
  `{ control: Control; siblings: Control[]; onChange: (c: Control) => void }`.

- [ ] **Step 1: Implement the component**

Create `src/lib/components/config/VirtualEditor.svelte`:

```svelte
<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { applyRead } from "$lib/utils/transform";
  import {
    sanitizeLabel,
    computeVirtual,
    type LocalControl,
  } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue } from "$lib/config/format";

  let {
    control,
    siblings,
    onChange,
  }: {
    control: Control;
    siblings: Control[];
    onChange: (c: Control) => void;
  } = $props();

  function setExpr(expr: string) {
    onChange({ ...control, virtual: { ...control.virtual, expr } });
  }
  function setPrecision(v: string) {
    onChange({
      ...control,
      virtual: {
        ...control.virtual,
        expr: control.virtual?.expr ?? "",
        precision: v === "" ? undefined : Number(v),
      },
    });
  }

  function liveOf(c: Control): unknown {
    if (c.kind === "virtual" || !c.stateId) return undefined;
    const st: any = ioBroker.states.get(c.stateId);
    return st ? applyRead(st.val, c.transform) : undefined;
  }

  // Local variable legend (state controls only), mirroring buildScope's naming.
  const legend = $derived.by(() => {
    const taken = new Set<string>();
    return siblings
      .filter((c) => c.kind !== "virtual")
      .map((c) => ({
        name: sanitizeLabel(c.label || c.feature, taken),
        value: liveOf(c),
      }));
  });

  const locals = $derived<LocalControl[]>(
    siblings.map((c) => ({
      kind: c.kind,
      label: c.label,
      feature: c.feature,
      liveValue: liveOf(c),
    })),
  );

  const preview = $derived(
    computeVirtual({ virtual: control.virtual }, locals, getVirtualPool()),
  );
</script>

<div class="virtual-editor">
  <label class="field">
    <span class="label-mono">Expression</span>
    <textarea
      rows="3"
      spellcheck="false"
      class="mono"
      value={control.virtual?.expr ?? ""}
      oninput={(e) => setExpr(e.currentTarget.value)}
    ></textarea>
  </label>

  <div class="cols">
    <div class="vars">
      <span class="label-mono">Variables</span>
      {#each legend as l (l.name)}
        <button
          type="button"
          class="var"
          title="Insert"
          onclick={() => setExpr((control.virtual?.expr ?? "") + l.name)}
        >
          <code>{l.name}</code> = {formatValue(l.value)}
        </button>
      {/each}
    </div>
    <div class="ref">
      <span class="label-mono">Helpers</span>
      <code>values(f)</code><code>count(f, pred?)</code><code>sum/avg/min/max(f)</code>
      <code>any/all(f, pred?)</code><code>get(stateId)</code
      ><code>get(device + label)</code><code>device(name).label</code>
      <span class="label-mono">filter: role·room·device·feature·label</span>
    </div>
  </div>

  <div class="row">
    <label class="field small"
      ><span class="label-mono">Precision</span>
      <input
        type="number"
        min="0"
        max="10"
        value={control.virtual?.precision ?? ""}
        oninput={(e) => setPrecision(e.currentTarget.value)}
      /></label
    >
    <div class="preview">
      <span class="label-mono">Result</span>
      {#if preview.error}
        <span class="err">{preview.error}</span>
      {:else}
        <span class="mono">{formatValue(preview.value, control.unit)}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .virtual-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-low, #fafafa);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.small {
    max-width: 8rem;
  }
  textarea.mono {
    font-family: var(--font-mono);
    resize: vertical;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .vars,
  .ref {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .var {
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    padding: 0;
    font-size: var(--body-sm);
  }
  .var:hover {
    color: var(--primary);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .err {
    color: var(--danger-color, #c0392b);
    font-size: var(--body-sm);
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/config/VirtualEditor.svelte
git commit -m "feat(virtual): formula editor with live test"
```

---

### Task 6: ControlRow kind selector + DeviceForm add-virtual

**Files:**
- Modify: `src/lib/components/config/ControlRow.svelte`
- Modify: `src/lib/components/config/DeviceForm.svelte`

**Interfaces:**
- Consumes: `VirtualEditor` (Task 5).
- Produces: `ControlRow` accepts a new prop `siblings: Control[]`; `DeviceForm` renders an *Add virtual state* button.

- [ ] **Step 1: Add the kind selector and virtual branch to `ControlRow.svelte`**

Add `siblings` to the props (default `[]`):

```ts
  import VirtualEditor from "./VirtualEditor.svelte";
  let {
    control,
    deviceType,
    siblings = [],
    onChange,
    onRemove,
  }: {
    control: Control;
    deviceType: DeviceType;
    siblings?: Control[];
    onChange: (c: Control) => void;
    onRemove: () => void;
  } = $props();

  const isVirtual = $derived(control.kind === "virtual");

  function setKind(kind: string) {
    if (kind === "virtual") {
      onChange({
        ...control,
        kind: "virtual",
        writable: false,
        stateId: undefined,
        transform: undefined,
        virtual: control.virtual ?? { expr: "" },
      });
    } else {
      onChange({ ...control, kind: undefined, virtual: undefined });
    }
  }
```

In the first `.line`, add the kind `<select>` before the feature select, and render the feature select only for state controls:

```svelte
    <select
      class="kind"
      value={control.kind ?? "state"}
      onchange={(e) => setKind(e.currentTarget.value)}
      aria-label="Control kind"
    >
      <option value="state">State</option>
      <option value="virtual">Virtual</option>
    </select>

    {#if !isVirtual}
      <select class="feature" ...>...</select>
    {/if}
```

Wrap the state-only parts (the `.state` block, the `writable` checkbox, and the transform toggle button) in `{#if !isVirtual} … {/if}`. Replace the transform block at the bottom with:

```svelte
  {#if isVirtual}
    <VirtualEditor
      {control}
      {siblings}
      onChange={(c) => onChange(c)}
    />
  {:else if showTransform}
    <TransformEditor
      transform={control.transform}
      sampleValue={live()?.val}
      onChange={(t) => onChange({ ...control, transform: t })}
    />
  {/if}
```

Guard `live()` for virtual controls: `if (!control.stateId) return undefined;` at the top of `live()`.

- [ ] **Step 2: Add the *Add virtual state* button and pass siblings in `DeviceForm.svelte`**

Add a function:

```ts
  function addVirtual() {
    controls = [
      ...controls,
      {
        id: crypto.randomUUID(),
        kind: "virtual",
        feature: "value",
        writable: false,
        label: "",
        virtual: { expr: "" },
      },
    ];
  }
```

In `.controls-head`, add the button next to *Add state*:

```svelte
      <button
        type="button"
        class="icon-btn"
        title="Add virtual state"
        aria-label="Add virtual state"
        onclick={addVirtual}
      >
        <span class="material-symbols-outlined">functions</span>
      </button>
```

Pass `siblings` to each `ControlRow`:

```svelte
      <ControlRow
        {control}
        deviceType={type}
        siblings={controls}
        onChange={(c) => updateControl(i, c)}
        onRemove={() => removeControl(i)}
      />
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/config/ControlRow.svelte src/lib/components/config/DeviceForm.svelte
git commit -m "feat(virtual): add-virtual affordance and kind selector"
```

---

### Task 7: Dashboard rendering

**Files:**
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: `EnrichedControl.virtualError` (Task 4).
- Produces: virtual value shown via the value widget; inline warning on error.

- [ ] **Step 1: Show the error inline**

In `src/routes/+page.svelte`, inside the control row, after the label span, add:

```svelte
              {#if control.virtualError}
                <span class="err" title={control.virtualError}>⚠</span>
              {/if}
```

Add a `.err` rule to the component `<style>`:

```css
  .err {
    color: var(--danger-color, #c0392b);
    font-size: var(--body-sm);
  }
```

The value branch (`{:else}` → `formatValue(control.liveValue, control.unit)`) already renders a virtual control; `liveValue === undefined` formats to `—`.

- [ ] **Step 2: Verify it builds**

Run: `npm run check && npm run build`
Expected: 0 errors; build writes `www/`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(virtual): render virtual value + error on dashboard"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all tests pass (existing + new virtual-ops/project tests).

- [ ] **Step 2: Lint, type-check, build**

Run: `npm run lint && npm run check && npm run build`
Expected: lint clean; 0 errors/0 warnings; build succeeds.

- [ ] **Step 3: Manual smoke test (requires a live ioBroker broker)**

Run: `npm run dev`
- Add a device with two state controls (e.g. temperature, humidity).
- *Add virtual state*, set label `Dew point`, expression `temperature - (100 - humidity) / 5`, precision `1`; confirm the live **Result** shows a number.
- Enter a bad expression (`temperature +`) and confirm an inline error, no crash.
- Save, reload, confirm the virtual control persists and the dashboard shows its value.
- Try an aggregate: `count({ role: "battery" }, v => v < 20)`.

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 5: Final commit (if the smoke test produced changes)**

```bash
git add -A
git commit -m "test(virtual): verification pass" || echo "nothing to commit"
```
