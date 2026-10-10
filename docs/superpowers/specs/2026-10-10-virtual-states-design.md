# Virtual States — Design Spec

- **Date:** 2026-10-10
- **Status:** Draft (awaiting review)
- **Topic:** Read-only *computed / aggregate* controls ("virtual states") that derive a
  value from other device states through an editable JavaScript expression.

## 1. Goal

Let a device carry **virtual states**: controls whose value is not read from an ioBroker
object but **computed** from other states. A virtual state is defined by a single editable
expression (a "formula/function") that gets:

- the device's **own state values** as variables (named after each control's sanitized
  label), and
- a small **helper API** that can read and aggregate over the states already defined by
  devices (the used-state pool), not the whole ioBroker namespace.

Motivating examples:

- Dew point on a thermometer: `temperature - (100 - humidity) / 5`.
- Count of devices with low battery: `count({ role: "value.battery" }, v => v < 20)`.
- Sum of lights switched on: `sum({ feature: "power" })`.
- Any motion sensor active: `any({ role: "sensor.motion" })`.

Virtual states are **read-only** and render like any other value control.

### Non-goals
- No fan-out / group writes (writing one control to many states).
- No server-side computation; everything runs client-side in the visual layer.
- No access to arbitrary ioBroker states — only states already referenced by devices.
- No sandbox/worker isolation beyond the existing `new Function` trust model used by the
  formula transform.
- No dependency resolution between virtual states in v1 (see Open questions).

## 2. Data model (`src/lib/types/device.ts`)

Add a discriminant `kind` to `Control`; keep it optional so existing registries load
unchanged (`kind` absent ⇒ `"state"`).

```ts
export interface VirtualSpec {
  expr: string;          // JS expression, e.g. "temperature - (100 - humidity) / 5"
  precision?: number;    // optional display rounding
}

export interface Control {
  id: string;
  kind?: "state" | "virtual";   // absent ⇒ "state" (back-compat)
  feature: string;              // virtual uses a display feature ("value" default)
  stateId?: string;             // absent when virtual
  writable: boolean;            // virtual ⇒ false (read-only)
  label?: string;
  unit?: string;
  hidden?: boolean;
  transform?: Transform;        // unused for virtual (the expr is the compute)
  virtual?: VirtualSpec;        // present when kind === "virtual"
  common?: ControlCommon;
}
```

`EnrichedControl` for a virtual control: `liveValue` = computed result,
`exists = available = true`, `widget = "value"` (or `"enum"`), and
`virtualError?: string` carries any evaluation error. `Device` and
`DeviceRegistry` are unchanged.

## 3. Engine (`src/lib/config/virtual-ops.ts`, new)

Pure and testable; mirrors the existing `runStep` result shape `{ value, error? }`.

- `sanitizeLabel(label, taken)` → JS identifier: lower-case, spaces/symbols → `_`, invalid
  chars stripped; collisions get an index suffix (`temperature`, `temperature2`, ...).
- `buildScope(device, pool)`:
  - **locals** — the device's **state-backed** controls, keyed by sanitized label → live
    value. v1 excludes other virtual controls to avoid cycles (see Open questions).
  - **globals** — helper API over the **device-state pool** (every state referenced by any
    device; the existing used-state cache). Each pool entry:
    `{ stateId, value, role, room, device, feature, label }`.
- `evaluateVirtual(expr, scope)` → compiled via
  `new Function(...localNames, ...helperNames, "return (" + expr + ")")`, wrapped in
  try/catch. **Never throws**; on failure returns `{ value: undefined, error }`.

### Helper API (globals)

- `get(ref)` — value of one state. `ref` is a stateId string, or
  `{ device, label }` (also reachable as `device("Kitchen").temperature`).
- `values(filter)` → array of values matching `filter`.
- `count(filter, pred?)` → number of matching entries (with optional predicate).
- `sum(filter)` / `avg(filter)` / `min(filter)` / `max(filter)` → number.
- `any(filter, pred?)` / `all(filter, pred?)` → boolean.

`filter = { role?, room?, device?, feature?, label? }` — every provided key must match.

## 4. Recompute & error handling

- Virtual values are **derived reactively**: the enriched store already re-derives when any
  used state changes, so each virtual control recomputes then. Memoization can be added
  later if the pool grows.
- Errors (syntax error, unknown variable, empty aggregate) render the value as `—` with an
  inline warning and never throw — the same policy as transform errors.
- Empty-set semantics: `count` → `0`, `sum` → `0`, `any` → `false`, `all` → `true`,
  `avg/min/max` → `undefined`.

## 5. UI — `ControlRow.svelte` + `VirtualEditor.svelte`

**`ControlRow.svelte`** gains a `kind` selector (State | Virtual):

- **State** (default): today's fields (feature, stateId, writable, label, unit,
  TransformEditor).
- **Virtual**: hides stateId / writable / transform; shows label, unit, precision, and
  mounts `VirtualEditor`.

`DeviceForm.svelte` gains an **Add virtual state** button (next to *Add state*) that appends
a `{ kind: "virtual", feature: "value", virtual: { expr: "" } }` control; `ControlRow`
receives the sibling controls so the editor can build the local variable scope.

**`VirtualEditor.svelte` (new)** — the formula workbench:

- **Expression** — monospace textarea for `expr`.
- **Variables panel** — the device's state-backed controls as
  `sanitizedLabel = <current value>` (live), click-to-insert.
- **Helpers panel** — short reference for `get`, `values`, `count`, `sum/avg/min/max`,
  `any/all`, filter keys, plus click-to-insert snippets.
- **Live test** — debounced; runs `evaluateVirtual` against current values and shows the
  formatted **result**, or an inline **error** (syntax error / unknown variable / empty
  aggregate), and a hint when the result is `undefined`.

## 6. Rendering (dashboard, `src/routes/+page.svelte`)

Widgets render on the dashboard (`src/routes/+page.svelte`); `/devices` is the CRUD config
page. A virtual control renders with the `value` widget (read-only), formatted via the
existing `formatValue` / `formatBoolean`. On evaluation error it shows `—` with an inline
warning and is never writable.

## 7. Files

**Edit**
- `src/lib/types/device.ts` — `kind`, `VirtualSpec`, `virtual?` on `Control`; `virtualError`
  on `EnrichedControl`.
- `src/lib/stores/devices.svelte.ts` — build the device-state pool, enrich virtual controls
  (compute `liveValue` / `virtualError` / `widget`), export `getVirtualPool()`.
- `src/lib/components/config/ControlRow.svelte` — kind selector + mount `VirtualEditor`.
- `src/lib/components/config/DeviceForm.svelte` — *Add virtual state* button; pass siblings.
- `src/routes/+page.svelte` — render virtual value + error state (dashboard widget).

**New**
- `src/lib/config/virtual-ops.ts` — `sanitizeLabel`, `buildScope`, `computeVirtual`,
  `evaluateVirtual`, helpers.
- `src/lib/config/virtual-ops.test.ts`.
- `src/lib/components/config/VirtualEditor.svelte`.

(No separate `virtual-pool` store: pool building is a pure step inside the existing
`devices.svelte.ts` enrichment; the engine stays in `virtual-ops.ts`.)

All new/edited Svelte components use Svelte 5 runes and TypeScript; no new runtime deps.

## 8. Migration

None required. `kind` absent ⇒ `"state"`, so existing registries load unchanged. Virtual
controls are additive.

## 9. Testing

- Vitest unit tests (`virtual-ops.test.ts`):
  - `sanitizeLabel` — normalisation and collision suffixes (`temperature2`, `temperature3`).
  - Each helper with filters and predicates.
  - `evaluateVirtual` — success, syntax error, unknown variable.
  - Dew-point, "count low battery", "any motion active" examples.
  - Empty-set semantics.
- Manual: add a virtual control, watch the live test, save, reload, confirm the value
  renders on the Devices page.

## 10. Open questions / decisions

### Decisions
- Purpose: read-only **computed/aggregate** state (not fan-out).
- References: **both** named inputs (locals by label) **and** filters over the device pool.
- Engine: **single editable JS expression** with an injected scope (Approach 1), reusing the
  existing `new Function` + `{ value, error }` pattern.
- Local variable naming: **sanitized label**, collisions get an index suffix.
- Placement: a **control on a device** (new `kind`), rendered with the value widget.
- Cross-device addressing: **filter + explicit refs** (`get({ device, label })`).
- Error feedback: inline in the editor's live test **and** on the Devices page.

### Open questions
- Should a virtual state be able to reference **another virtual state** on the same device?
  v1 says no (avoids dependency cycles); revisit with ordered evaluation + cycle detection.
