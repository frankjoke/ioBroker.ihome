# Device Configuration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configuration UI that lets the user create devices holding multiple state IDs, each with optional per-direction (input/output) transforms, plus a filtered tree-view state picker showing current value and last-changed.

**Architecture:** Pure logic first (transform engine, feature table, state-tree/filter builder, formatters) as unit-tested modules, then thin Svelte 5 runes components layered on top. The existing `stores/devices.svelte.ts` registry + `registry.svelte.js` persistence are reused; the Devices page renders each control by a `widget` resolved from the feature.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Vitest (node env), the existing ioBroker socket layer (`ioBrokerConnect.svelte.js`).

**Spec:** `docs/superpowers/specs/2026-10-09-device-config-ui-design.md`

## Global Constraints

- Svelte components use Svelte 5 runes + TypeScript. No legacy `createEventDispatcher`/`on:` in new components.
- No new runtime dependencies.
- Tests: Vitest, `environment: "node"`, `expect.requireAssertions: true` — every test needs ≥1 assertion. Test files live at `src/**/*.{test,spec}.{js,ts}`.
- Registry id is `DEVICE_LIST_ID = "0_userdata.0.Test.AiHome.deviceList"`.
- Only **used** states are cached; the picker fetches values on demand (never adds to the state cache).
- `applyRead`/`applyWrite` must never throw; a failing transform returns the raw value.
- JSON-path transforms are **read-only**.
- Definition of done per task: `npm run lint` clean, `npx svelte-check --tsconfig ./tsconfig.json` 0 errors, `npm run build` succeeds.
- **This directory is not a git repo.** Either run `git init` once before Task 1, or skip every "Commit" step. Commit steps below assume git is available.

## Review Focus

Five input classes / failure modes the spec implies; each is pinned by a test in its owning task:

1. **Bad formula** (syntax error, or runtime throw such as `x.foo` on a number) → raw value returned, `error` set, never throws. *(Task 1)*
2. **Scale with `inMax === inMin`** → returns `outMin`, never `NaN`/`Infinity`. *(Task 1)*
3. **JSON path on a non-object or missing path** → original value returned, no throw. *(Task 1)*
4. **Legacy registry transform** (`{type:"scale"|"map"}` loaded from ioBroker) → migrated to the new shape, not dropped. *(Task 1)*
5. **Picker value fetch where one id fails/does not exist** → the failing id is skipped, the rest still resolve, and a missing state renders as unavailable. *(Task 5)*

---

### Task 1: Transform engine

**Files:**
- Modify: `src/lib/types/device.ts`
- Create: `src/lib/config/transform-ops.ts`
- Modify: `src/lib/utils/transform.ts`
- Test: `src/lib/config/transform-ops.test.ts`
- Test: `src/lib/utils/transform.test.ts`

**Interfaces:**
- Produces (from `$lib/types/device`): `DeviceType`, `TransformKind`, `TransformStep`, `Transform`, `Control`, `Device`, `DeviceRegistry`, `EnrichedControl`, `EnrichedDevice`.
- Produces (from `$lib/config/transform-ops`):
  - `interface StepResult { value: unknown; error?: string }`
  - `function runStep(step: TransformStep | undefined, v: unknown): StepResult`
  - `function previewTransform(step: TransformStep | undefined, v: unknown): StepResult` (alias of `runStep`, used by the editor)
  - `function resolveJsonPath(obj: unknown, path: string): unknown`
  - `function evaluateFormula(expr: string, x: unknown): unknown`
  - `function migrateTransform(old: unknown): Transform | undefined`
  - `function migrateRegistry(raw: any): any` (migrates every device's control transforms)
- Produces (from `$lib/utils/transform`): `applyRead(v, transform?): unknown`, `applyWrite(v, transform?): unknown` (signatures unchanged).

- [ ] **Step 1: Write the failing tests**

`src/lib/config/transform-ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  runStep, resolveJsonPath, migrateTransform, migrateRegistry,
} from "$lib/config/transform-ops";

describe("runStep scale", () => {
  it("maps the input range to the output range", () => {
    expect(runStep({ kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 }, 50).value).toBe(0.5);
  });
  it("clamps when clamp is not false", () => {
    expect(runStep({ kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 }, 200).value).toBe(1);
  });
  it("does not divide by zero when inMin === inMax", () => {
    expect(runStep({ kind: "scale", inMin: 5, inMax: 5, outMin: 7, outMax: 9 }, 5).value).toBe(7);
  });
  it("rounds to the given number of decimals", () => {
    expect(runStep({ kind: "scale", inMin: 0, inMax: 3, outMin: 0, outMax: 1, round: 2 }, 1).value).toBe(0.33);
  });
});

describe("runStep map", () => {
  it("maps known keys", () => {
    expect(runStep({ kind: "map", map: { ON: true, OFF: false } }, "ON").value).toBe(true);
  });
  it("passes unknown keys through", () => {
    expect(runStep({ kind: "map", map: { ON: true } }, "X").value).toBe("X");
  });
});

describe("runStep formula", () => {
  it("evaluates a valid expression", () => {
    expect(runStep({ kind: "formula", expr: "x*2+1" }, 3).value).toBe(7);
  });
  it("falls back to the raw value and reports an error on invalid syntax", () => {
    const r = runStep({ kind: "formula", expr: "x*" }, 3);
    expect(r.value).toBe(3);
    expect(r.error).toBeTruthy();
  });
  it("falls back to the raw value and reports an error on a runtime throw", () => {
    const r = runStep({ kind: "formula", expr: "x.foo.bar" }, 3);
    expect(r.value).toBe(3);
    expect(r.error).toBeTruthy();
  });
});

describe("runStep jsonpath", () => {
  it("extracts a nested value", () => {
    expect(runStep({ kind: "jsonpath", path: "a.b" }, { a: { b: 42 } }).value).toBe(42);
  });
  it("extracts an array index", () => {
    expect(runStep({ kind: "jsonpath", path: "s[0].v" }, { s: [{ v: 9 }] }).value).toBe(9);
  });
  it("returns the original value when the path is missing", () => {
    expect(runStep({ kind: "jsonpath", path: "a.z" }, { a: { b: 1 } }).value).toEqual({ a: { b: 1 } });
  });
});

describe("resolveJsonPath", () => {
  it("returns undefined for a missing segment", () => {
    expect(resolveJsonPath({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("migrateTransform", () => {
  it("migrates a legacy scale to both directions", () => {
    const t = migrateTransform({ type: "scale", inMin: 0, inMax: 10, outMin: 0, outMax: 100 });
    expect(t?.read).toMatchObject({ kind: "scale", outMax: 100 });
    expect(t?.write).toMatchObject({ kind: "scale" });
  });
  it("migrates a legacy map read/write", () => {
    const t = migrateTransform({ type: "map", read: { A: 1 }, write: { 1: "A" } });
    expect(t?.read).toEqual({ kind: "map", map: { A: 1 } });
    expect(t?.write).toEqual({ kind: "map", map: { 1: "A" } });
  });
  it("passes through an already-migrated transform", () => {
    const t = migrateTransform({ read: { kind: "formula", expr: "x" } });
    expect(t?.read).toEqual({ kind: "formula", expr: "x" });
  });
  it("returns undefined for undefined", () => {
    expect(migrateTransform(undefined)).toBeUndefined();
  });
});

describe("migrateRegistry", () => {
  it("migrates each control's transform and preserves the rest", () => {
    const raw = { version: 1, updatedAt: 0, devices: [
      { id: "d1", name: "D", type: "Switch", controls: [
        { id: "c1", feature: "power", stateId: "a.0.b", writable: true, readable: true,
          transform: { type: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 } },
      ] },
    ] };
    const out = migrateRegistry(raw);
    expect(out.devices[0].controls[0].transform.read.kind).toBe("scale");
    expect(out.devices[0].controls[0].feature).toBe("power");
  });
});
```

`src/lib/utils/transform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyRead, applyWrite } from "$lib/utils/transform";

describe("applyRead", () => {
  it("runs the read step", () => {
    expect(applyRead(50, { read: { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 } })).toBe(0.5);
  });
  it("returns the value unchanged without a transform", () => {
    expect(applyRead(5, undefined)).toBe(5);
  });
  it("never throws on a bad formula", () => {
    expect(applyRead(5, { read: { kind: "formula", expr: "x*" } })).toBe(5);
  });
});

describe("applyWrite", () => {
  it("runs the write step", () => {
    expect(applyWrite(1, { write: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 } })).toBe(100);
  });
  it("returns the value unchanged without a transform", () => {
    expect(applyWrite("A", undefined)).toBe("A");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/transform-ops.test.ts src/lib/utils/transform.test.ts`
Expected: FAIL — `transform-ops` module not found; `applyRead` returns input unchanged for the new shape.

- [ ] **Step 3: Add the types in `src/lib/types/device.ts`**

Replace `TransformMap`/`TransformScale`/`Transform` with:

```ts
export type DeviceType =
  | "Switch" | "Light" | "Thermostat" | "Blind" | "Window"
  | "AC" | "Thermometer" | "Value" | "Custom";

export type TransformKind = "scale" | "map" | "formula" | "jsonpath";

export type TransformStep =
  | { kind: "scale"; inMin: number; inMax: number; outMin: number; outMax: number; clamp?: boolean; round?: number }
  | { kind: "map"; map: Record<string, unknown> }
  | { kind: "formula"; expr: string }
  | { kind: "jsonpath"; path: string };

export interface Transform { read?: TransformStep; write?: TransformStep }
```

Also add in this file: `export type Widget = "switch" | "level" | "color" | "value" | "enum" | "button";`. Keep `Control` (change `transform?: Transform`), `Device` (change `type: DeviceType`, add `icon?: string`), `DeviceRegistry`, `LiveState`. Add `widget: Widget` to `EnrichedControl` (same file, no import).

- [ ] **Step 4: Implement `src/lib/config/transform-ops.ts`**

Key logic:
- `runStep(step, v)`: if no step → `{ value: v }`. `scale`: clamp when `clamp !== false`; if `inMax === inMin` return `outMin`; else `outMin + (x-inMin)*(outMax-outMin)/(inMax-inMin)`; apply `round` via `Number(x.toFixed(round))` when defined. `map`: lookup by `String(v)`, else pass through. `formula`: `try { value: evaluateFormula(expr, v) } catch (e) { value: v, error: String(e) }`. `jsonpath`: `const r = resolveJsonPath(v, path); value: r === undefined ? v : r`.
- `evaluateFormula(expr, x)`: `return new Function("x", "return (" + expr + ");")(x)` (throws propagate).
- `resolveJsonPath(obj, path)`: split on `.`; for each segment, parse a trailing `[n]` index; walk; return `undefined` if any step is missing/not an object/array.
- `previewTransform = runStep`.
- `migrateTransform(old)`: if falsy → `undefined`; if it has `read`/`write` (new shape) → return as-is; if `old.type === "scale"` → `{ read: {kind:"scale", ...params}, write: {kind:"scale", ...params} }`; if `old.type === "map"` → `{ read: {kind:"map", map: old.read ?? {}}, write: {kind:"map", map: old.write ?? {}} }`; else `undefined`.
- `migrateRegistry(raw)`: clone `raw`, map each device's controls to `{ ...c, transform: migrateTransform(c.transform) }`, return.

- [ ] **Step 5: Update `src/lib/utils/transform.ts`**

Replace both functions' bodies: `applyRead(v, transform) => runStep(transform?.read, v).value`, `applyWrite(v, transform) => runStep(transform?.write, v).value` (import `runStep` from `$lib/config/transform-ops`). Keep the existing `(v, transform?)` signatures.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/transform-ops.test.ts src/lib/utils/transform.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint, typecheck, build**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Expected: lint 0 problems; svelte-check 0 errors; build succeeds.

- [ ] **Step 8: Commit** (skip if no git)

```bash
git add src/lib/types/device.ts src/lib/config/transform-ops.ts src/lib/utils/transform.ts src/lib/config/transform-ops.test.ts src/lib/utils/transform.test.ts
git commit -m "feat: per-direction transform engine (scale/map/formula/jsonpath)"
```

---

### Task 2: Feature model

**Files:**
- Create: `src/lib/config/features.ts`
- Test: `src/lib/config/features.test.ts`

**Interfaces:**
- Produces: `interface FeatureDef { feature: string; label: string; widget: Widget; roleHints: string[] }`;
  `const DEVICE_FEATURES: Record<DeviceType, FeatureDef[]>`;
  `function featureDef(deviceType: DeviceType, feature: string): FeatureDef | undefined`;
  `function widgetFor(deviceType: DeviceType, feature: string): Widget`;
  `function suggestFeature(obj: any, deviceType: DeviceType): string | undefined`.
- Consumes: `DeviceType`, `Widget` from `$lib/types/device`.

- [ ] **Step 1: Write the failing tests**

`src/lib/config/features.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEVICE_FEATURES, suggestFeature, widgetFor, featureDef } from "$lib/config/features";

it("suggests brightness for a level-role light", () => {
  expect(suggestFeature({ common: { role: "level.dimmer", type: "number" } }, "Light")).toBe("brightness");
});
it("suggests power for a boolean switch state", () => {
  expect(suggestFeature({ common: { role: "switch", type: "boolean" } }, "Switch")).toBe("power");
});
it("falls back to value for an unknown role", () => {
  expect(suggestFeature({ common: { role: "unknown.thing", type: "number" } }, "Value")).toBe("value");
});
it("resolves the widget for a known feature", () => {
  expect(widgetFor("Light", "brightness")).toBe("level");
});
it("falls back to the value widget for an unknown feature", () => {
  expect(widgetFor("Switch", "nope")).toBe("value");
});
it("featureDef returns undefined for an unknown feature", () => {
  expect(featureDef("Switch", "nope")).toBeUndefined();
});
it("has a feature table for every device type", () => {
  expect(Object.keys(DEVICE_FEATURES)).toEqual(
    expect.arrayContaining(["Switch", "Light", "Thermostat", "Blind", "Window", "AC", "Thermometer", "Value", "Custom"]),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/config/features.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/config/features.ts`**

Feature table exactly as in the spec §3 (Light → power/brightness/color/colorTemp; Thermostat → actual/setpoint/mode; Blind → position/stop; Window → open; AC → power/mode/temperature/fan; Thermometer → temperature/humidity; Switch → power; Value → value; Custom → value/power/level), each with a `widget` and `roleHints`.

- `suggestFeature(obj, deviceType)`: scan `DEVICE_FEATURES[deviceType]`; return the first `feature` whose `roleHints` includes a substring match against `obj.common.role` (then `obj.common.type`). Fallback: `obj.common.type === "boolean"` → `"power"`; else `"value"`.
- `featureDef`: `DEVICE_FEATURES[deviceType]?.find(f => f.feature === feature)`.
- `widgetFor`: `featureDef(deviceType, feature)?.widget ?? "value"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/config/features.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/config/features.ts src/lib/config/features.test.ts && git commit -m "feat: device feature table and role-based suggestion"`

---

### Task 3: State tree + filter builder (pure)

**Files:**
- Create: `src/lib/config/state-tree.ts`
- Test: `src/lib/config/state-tree.test.ts`

**Interfaces:**
- Produces:
  - `interface StateRef { id: string; obj: any }`
  - `interface StateNode { id: string; label: string; kind: "adapter" | "folder" | "state"; obj?: any; children?: StateNode[] }`
  - `interface StateFilters { adapter?: string; room?: string; type?: string; role?: string; search?: string }`
  - `function collectStates(objects: Map<string, any>): StateRef[]`
  - `function applyFilters(states: StateRef[], filters: StateFilters, roomsOf?: (id: string) => string[]): StateRef[]`
  - `function buildStateTree(states: StateRef[]): StateNode[]`

- [ ] **Step 1: Write the failing tests**

`src/lib/config/state-tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectStates, applyFilters, buildStateTree } from "$lib/config/state-tree";

const objects = new Map<string, any>([
  ["hue.0.lamp.on", { _id: "hue.0.lamp.on", type: "state", common: { name: "Lamp", type: "boolean", role: "switch" } }],
  ["hue.0.lamp.bri", { _id: "hue.0.lamp.bri", type: "state", common: { name: "Bright", type: "number", role: "level" } }],
  ["hue.0.lamp", { _id: "hue.0.lamp", type: "channel", common: { name: "Lamp" } }],
  ["zigbee.0.temp", { _id: "zigbee.0.temp", type: "state", common: { name: "Temp", type: "number", role: "value.temperature" } }],
]);

it("collects only state objects", () => {
  expect(collectStates(objects).every((s) => s.obj.type === "state")).toBe(true);
  expect(collectStates(objects)).toHaveLength(3);
});
it("filters by adapter", () => {
  expect(applyFilters(collectStates(objects), { adapter: "hue.0" })).toHaveLength(2);
});
it("filters by role substring", () => {
  expect(applyFilters(collectStates(objects), { role: "level" })).toHaveLength(1);
});
it("filters by type", () => {
  expect(applyFilters(collectStates(objects), { type: "boolean" })).toHaveLength(1);
});
it("filters by text search over id and name", () => {
  expect(applyFilters(collectStates(objects), { search: "bright" })).toHaveLength(1);
});
it("filters by room using the injected resolver", () => {
  const roomsOf = (id: string) => (id.startsWith("zigbee") ? ["enum.rooms.living"] : []);
  expect(applyFilters(collectStates(objects), { room: "enum.rooms.living" }, roomsOf)).toHaveLength(1);
});
it("builds an adapter-rooted tree with state leaves", () => {
  const tree = buildStateTree(collectStates(objects));
  const adapters = tree.map((n) => n.id).sort();
  expect(adapters).toEqual(["hue.0", "zigbee.0"]);
  const hue = tree.find((n) => n.id === "hue.0")!;
  const leaves: string[] = [];
  const walk = (n: any) => (n.kind === "state" ? leaves.push(n.id) : n.children?.forEach(walk));
  walk(hue);
  expect(leaves.sort()).toEqual(["hue.0.lamp.bri", "hue.0.lamp.on"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/config/state-tree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/config/state-tree.ts`**

- `collectStates`: iterate `objects.values()`, keep `type === "state"`, return `{ id: obj._id, obj }`.
- `applyFilters`: drop entries failing any set filter. `adapter` = `id.split(".")[0]` equality; `type`/`role` = `String(obj.common?.type|role ?? "")` includes filter; `search` = lowercased substring over `id` or `common.name`; `room` = `roomsOf?.(id).includes(filter)`.
- `buildStateTree`: group filtered states by adapter (`parts[0]`); within an adapter, nest by the intermediate path segments (`parts.slice(1, -1)`) as `folder` nodes, state as leaf. Sort children by id. Label = `common.name || lastSegment`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/config/state-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/config/state-tree.ts src/lib/config/state-tree.test.ts && git commit -m "feat: state tree and filter builder"`

---

### Task 4: Formatters (pure)

**Files:**
- Create: `src/lib/config/format.ts`
- Test: `src/lib/config/format.test.ts`

**Interfaces:**
- Produces: `function formatAge(ts: number, now?: number): string`; `function formatValue(v: unknown, unit?: string): string`.

- [ ] **Step 1: Write the failing tests**

`src/lib/config/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatAge, formatValue } from "$lib/config/format";

const now = 1_000_000_000_000;
it("formats 'now' under 4s", () => expect(formatAge(now - 1000, now)).toBe("now"));
it("formats seconds", () => expect(formatAge(now - 5000, now)).toBe("5s"));
it("formats minutes", () => expect(formatAge(now - 3 * 60_000, now)).toBe("3m"));
it("formats hours", () => expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h"));
it("formats days", () => expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d"));
it("returns empty for a missing timestamp", () => expect(formatAge(0, now)).toBe(""));
it("formats a value with a unit", () => expect(formatValue(23.5, "°C")).toBe("23.5 °C"));
it("formats booleans", () => expect(formatValue(true)).toBe("true"));
it("formats objects as JSON", () => expect(formatValue({ a: 1 })).toBe('{"a":1}'));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/config/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/config/format.ts`**

`formatAge`: `!ts` → `""`; `age = now - ts`; `< 4000` → `"now"`; `< 60_000` → `"Ns"`; `< 3_600_000` → `"Nm"`; `< 86_400_000` → `"Nh"`; else `"Nd"` (rounded). `formatValue`: `null/undefined` → `"—"`; object → `JSON.stringify`; else `String(v) + (unit ? " " + unit : "")`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/config/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/config/format.ts src/lib/config/format.test.ts && git commit -m "feat: value and age formatters"`

---

### Task 5: Wiring — enriched widget, registry migration, picker values

**Files:**
- Modify: `src/lib/stores/devices.svelte.ts` (add `widget` to each enriched control)
- Modify: `src/lib/registry.svelte.js` (run `migrateRegistry` on the parsed registry)
- Create: `src/lib/picker-values.svelte.js`

**Interfaces:**
- Consumes: `widgetFor` (Task 2), `migrateRegistry` (Task 1), `formatValue`/`formatAge` (Task 4), `ioBroker` from `$lib/ioBrokerConnect.svelte.js`.
- Produces (from `$lib/picker-values.svelte.js`):
  - `function getPickerValue(id: string): { val: unknown; ts: number } | undefined`
  - `async function fetchPickerValues(ids: string[]): Promise<void>` (fetches via `ioBroker.getState(id, true)` per id, in parallel, skipping failures).

- [ ] **Step 1: Add the widget to enrichment**

In `_devicesEnriched`, import `widgetFor` from `$lib/config/features` and add `widget: widgetFor(device.type, control.feature)` to the returned control object. `EnrichedControl.widget` is already typed (Task 1).

- [ ] **Step 2: Migrate the registry on load**

In `src/lib/registry.svelte.js`, import `migrateRegistry` and wrap both parse sites: `const parsed = parseRegistry(...)` → `setCanonicalRegistry(migrateRegistry(parsed))`.

- [ ] **Step 3: Implement `src/lib/picker-values.svelte.js`**

Use a `SvelteMap<string, { val: unknown; ts: number }>`; `fetchPickerValues(ids)` awaits `Promise.all(ids.map(id => Promise.resolve(ioBroker.getState(id, true)).then(st => { if (st) values.set(id, { val: st.val, ts: st.ts }); }).catch(() => {})))`. `getPickerValue` returns `values.get(id)`.

- [ ] **Step 4: Verify**

Run: `npx svelte-check --tsconfig ./tsconfig.json && npm run lint && npm run build`
Expected: 0 errors; lint clean; build succeeds.
Manual: none yet (no UI uses these until Task 6).

- [ ] **Step 5: Commit** (skip if no git)

```bash
git add src/lib/stores/devices.svelte.ts src/lib/registry.svelte.js src/lib/picker-values.svelte.js
git commit -m "feat: enriched widget, registry migration, picker value fetching"
```

---

### Task 6: StatePicker + StateTree components

**Files:**
- Create: `src/lib/components/discovery/StateTree.svelte`
- Create: `src/lib/components/discovery/StatePicker.svelte`
- Delete: `src/lib/components/discovery/StateSelectModal.svelte`

**Interfaces:**
- `StateTree` props: `{ nodes: StateNode[]; selection: Set<string>; onToggle: (id: string) => void }`. Renders expandable adapter/folder nodes and state leaves. Each leaf shows id, `common.name`, and — when `getPickerValue(id)` exists — `formatValue(val, common.unit)` plus `formatAge(ts)`.
- `StatePicker` props: `{ deviceType: DeviceType; objects: Map<string, any>; roomsOf: (id: string) => string[]; rooms: { id: string; label: string }[]; onAdd: (controls: Control[]) => void; onClose: () => void }`.
  - Owns filter state (adapter/room/type/role/search), selection set, and tree expansion.
  - Builds `collectStates(objects)` → `applyFilters(...)` → `buildStateTree(...)` (Tasks 3).
  - On filter/expansion change, calls `fetchPickerValues(visibleLeafIds)` (Task 5).
  - "Add N" builds one `Control` per selected state: `{ id: crypto.randomUUID(), feature: suggestFeature(obj, deviceType) ?? "value", stateId: id, writable: !!obj.common?.write, readable: !!obj.common?.read, label: obj.common?.name, unit: obj.common?.unit }` and calls `onAdd`.

- [ ] **Step 1: Implement `StateTree.svelte`** per the props above (recursive snippet or child self-import for nested nodes).
- [ ] **Step 2: Implement `StatePicker.svelte`** per the props above (filters bar + tree + selection tray + Add/Cancel).
- [ ] **Step 3: Delete `StateSelectModal.svelte`** and update any imports (the config page is rewritten in Task 9; remove the import there now to keep the build green).
- [ ] **Step 4: Verify (manual)**

Run: `npm run dev`. Temporarily render `<StatePicker>` from the config page with `objects={ioBroker.objects}`, `roomsOf`, `rooms`. Checklist: tree expands adapter→channel→state; each filter narrows the list; leaves show current value + age after the fetch resolves; selecting several and Add calls `onAdd` with correct controls; a non-existent id does not break the batch.

- [ ] **Step 5: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/components/discovery && git commit -m "feat: filtered tree state picker"`

---

### Task 7: TransformEditor component

**Files:**
- Create: `src/lib/components/config/TransformEditor.svelte`

**Interfaces:**
- Props: `{ transform: Transform | undefined; sampleValue: unknown; onChange: (t: Transform | undefined) => void }`.
- Read | Write tab; kind selector (None/Scale/Map/Formula/JSON path — JSON path only on the Read tab); parameter inputs per kind; a Map key→value list editor; a live preview via `previewTransform(step, sampleValue)` showing the result or the error.

- [ ] **Step 1: Implement `TransformEditor.svelte`** per the props above.
- [ ] **Step 2: Verify (manual)**

Run: `npm run dev`. Checklist: switching kind resets the step; entering `x*2` with sample `3` previews `6`; an invalid expression shows the error and previews the raw value; the Write tab hides JSON path; Map edits add/remove rows.

- [ ] **Step 3: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/components/config/TransformEditor.svelte && git commit -m "feat: transform editor with live preview"`

---

### Task 8: ControlRow + DeviceForm components

**Files:**
- Create: `src/lib/components/config/ControlRow.svelte`
- Create: `src/lib/components/config/DeviceForm.svelte`
- Delete: `src/lib/components/config/DeviceEditor.svelte`

**Interfaces:**
- `ControlRow` props: `{ control: Control; deviceType: DeviceType; onChange: (c: Control) => void; onRemove: () => void }`. Renders feature `<select>` (from `DEVICE_FEATURES[deviceType]`), read-only stateId + current value + age (via `getPickerValue`), writable/readable checkboxes, label/unit inputs, and an expandable `TransformEditor` (Task 7) bound to `control.transform`.
- `DeviceForm` props: `{ device: Device | null; rooms: { id: string; label: string }[]; onSave: (d: Device) => void; onCancel: () => void }`. Fields: name, type, room, section, panel, icon; control list (ControlRow[]); "Add state" opens `StatePicker` (Task 6) and appends the returned controls; Save/Cancel.

- [ ] **Step 1: Implement `ControlRow.svelte`.**
- [ ] **Step 2: Implement `DeviceForm.svelte`** (embedding `StatePicker` for add).
- [ ] **Step 3: Delete `DeviceEditor.svelte`** and remove its import from the config page (rewritten in Task 9).
- [ ] **Step 4: Verify (manual)**

Run: `npm run dev`. Checklist: feature dropdown lists the device type's features; changing a control updates the form state; Add state opens the picker and appends controls with suggested features; Save emits a `Device` with the edited controls; Cancel discards.

- [ ] **Step 5: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/lib/components/config && git commit -m "feat: device form and control rows"`

---

### Task 9: Config page CRUD + nav tab

**Files:**
- Modify: `src/routes/config/devices/+page.svelte`
- Modify: `src/lib/pages.js`

**Interfaces:**
- Consumes: `getCanonicalRegistry`, `setCanonicalRegistry`, `saveRegistry`, `DeviceForm` (Task 8), `ioBroker` (for `objects`/`enums`).
- Rooms: `ioBroker.enums.getList("rooms")` mapped to `{ id: enumObj._id, label: t_name(enumObj.common.name) }`; `roomsOf(id)` = `(ioBroker.enums.get(id)?.rooms ?? []).map(r => r._id)`.

- [ ] **Step 1: Rewrite the config page** as a device list (name, type, room, #controls) with Add / Edit / Duplicate / Delete (confirm) driving `DeviceForm`. Every mutation updates the registry via `setCanonicalRegistry` then `saveRegistry()`.
- [ ] **Step 2: Add the Config tab** to `src/lib/pages.js`: `{ id: "/config/devices", label: "Config", icon: "tune", title: "Device Configuration" }`.
- [ ] **Step 3: Verify (manual)**

Run: `npm run dev`. Checklist: the Config tab appears; Add creates a device that persists across reload; Edit updates it; Duplicate creates a copy with a new id; Delete removes it after confirmation; the Devices page reflects the changes.

- [ ] **Step 4: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/routes/config/devices/+page.svelte src/lib/pages.js && git commit -m "feat: device config page and nav tab"`

---

### Task 10: Devices page widget rendering + inline edit

**Files:**
- Modify: `src/routes/devices/+page.svelte`

**Interfaces:**
- Consumes: `devicesEnrichedStore` (now carrying `widget`), `applyWrite`, `ioBroker.setState`, `DeviceForm` (Task 8) for inline edit.

- [ ] **Step 1: Render each control by `control.widget`**: `switch` (toggle), `level` (range slider using `common.min/max/step`), `color` (color input), `value` (read-only), `enum` (select from `common.states`), `button` (momentary). Unavailable controls render disabled. Writes go through `applyWrite` then `ioBroker.setState`.
- [ ] **Step 2: Add an inline Edit affordance** per device that opens `DeviceForm` and saves via `setCanonicalRegistry` + `saveRegistry()`.
- [ ] **Step 3: Verify (manual)**

Run: `npm run dev`. Checklist: a Light with power+brightness renders a switch and a slider; toggling writes the state; a value-only control is read-only; an enum control shows the labels from `common.states`; inline edit round-trips through the registry.

- [ ] **Step 4: Lint, typecheck, build, commit**

Run: `npm run lint && npx svelte-check --tsconfig ./tsconfig.json && npm run build`
Then (if git): `git add src/routes/devices/+page.svelte && git commit -m "feat: widget-based device rendering with inline edit"`

---

## Self-Review

- **Spec coverage:** §2 model → Task 1; §3 features → Task 2; §4 config UI → Tasks 8–9; §5 picker → Tasks 3, 5, 6; §6 transform ops → Task 1; §7 rendering → Task 10; §8 files → mapped across tasks; §9 error handling → Tasks 1 (transform errors), 5 (fetch failures), 10 (unavailable); §10 testing → Tasks 1–4 unit tests + manual checks.
- **Review Focus:** all five lines are pinned by Task 1 (1–4) and Task 5 (5).
- **Type consistency:** `Widget`/`FeatureDef`/`DEVICE_FEATURES`/`suggestFeature`/`widgetFor`/`featureDef` (Task 2) are used verbatim in Tasks 5, 6, 8, 10. `runStep`/`previewTransform`/`migrateRegistry` (Task 1) used in Tasks 5, 7. `collectStates`/`applyFilters`/`buildStateTree` (Task 3) used in Task 6. `formatAge`/`formatValue` (Task 4) used in Tasks 6, 8.
- **Proportion:** logic tasks carry the tests; UI tasks specify props/behaviour and manual checks rather than transcribed markup.
