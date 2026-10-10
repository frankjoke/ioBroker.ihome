# Device Configuration UI — Design Spec

- **Date:** 2026-10-09
- **Status:** Draft (awaiting review)
- **Topic:** Populate the device list through a configuration UI; devices hold multiple
  state IDs with per-state input/output transforms.

## 1. Goal

Give the user a configuration UI to build the device list. A device holds one or
more state IDs; each state (control) can define an **input** (read: raw state → display)
and **output** (write: UI → raw state) transform. State selection happens in a modal
with a tree view plus filters (adapter instance, room, type, role), and the list shows
each candidate state's **current value** and **last-changed** time.

### Non-goals
- No server-side device discovery or auto-provisioning.
- No per-user layouts/permissions.
- No changes to the adapter's `main.js` / ioBroker lifecycle.
- `enabled`/scheduling/automation features are out of scope.

## 2. Data model (`src/lib/types/device.ts`)

Transforms become per-direction steps (replacing the current bidirectional
`scale`/`map` mix):

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

export interface Transform {
  read?: TransformStep;   // input  (state value -> UI value)
  write?: TransformStep;  // output (UI value  -> state value)
}

export interface Control {
  id: string;
  feature: string;          // see feature model
  stateId: string;
  writable: boolean;
  readable: boolean;
  label?: string;
  unit?: string;
  hidden?: boolean;
  transform?: Transform;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  room?: string;
  section?: string;
  panel?: string;
  icon?: string;            // material-symbols name (optional)
  controls: Control[];
}
```

`DeviceRegistry` (`version`, `updatedAt`, `devices`) is unchanged. `EnrichedControl`
gains `widget` (resolved from the feature) so the Devices page does not re-derive it.

### Migration
On registry load, any legacy `transform` with a top-level `type` field is converted:
- `{ type: "scale", inMin..outMax, clamp }` → `{ read: {kind:"scale",...}, write: {kind:"scale",...} }`
- `{ type: "map", read, write }` → `{ read: {kind:"map", map: read}, write: {kind:"map", map: write} }`

## 3. Feature model (`src/lib/config/features.ts`)

```ts
export type Widget = "switch" | "level" | "color" | "value" | "enum" | "button";

export interface FeatureDef {
  feature: string;      // stable key stored on Control
  label: string;        // display label
  widget: Widget;
  roleHints: string[];  // ioBroker common.role / common.type hints for auto-suggest
}

export const DEVICE_FEATURES: Record<DeviceType, FeatureDef[]>;
export function suggestFeature(obj: any): string | undefined;
```

Initial feature table:

| Device type | Features (feature → widget) |
|---|---|
| Switch | power → switch |
| Light | power → switch, brightness → level, color → color, colorTemp → level |
| Thermostat | actual → value, setpoint → level, mode → enum |
| Blind | position → level, stop → button |
| Window | open → switch |
| AC | power → switch, mode → enum, temperature → level, fan → level |
| Thermometer | temperature → value, humidity → value |
| Value | value → value |
| Custom | value → value, power → switch, level → level |

`suggestFeature(obj)` scans `obj.common.role` then `obj.common.type` against
`roleHints` of the selected device type and returns the first match (fallback:
`value` for readable-only, `power` for `common.type === "boolean"`).

## 4. Config UI (`/config/devices`, new "Config" header tab)

```
ConfigPage
├── DeviceList            (rows: name, type, room, #controls; Add/Edit/Duplicate/Delete)
├── DeviceForm            (create/edit)
│   ├── fields: name, type, room (enum dropdown + free text), section, panel, icon
│   └── ControlRow[]      (one per control)
│       ├── feature <select> (from DEVICE_FEATURES[type])
│       ├── stateId (read-only) + live value + age
│       ├── writable / readable checkboxes, label, unit
│       └── TransformEditor (inline expander)
└── StatePicker (modal, opened from "Add state")
```

- **Add state** opens `StatePicker` (multi-select); each selected state becomes a
  `Control` with an auto-suggested `feature`.
- **Duplicate** deep-copies a device with a new id.
- **Delete** requires confirmation.
- All mutations update the registry via `setCanonicalRegistry` then `saveRegistry()`.

### TransformEditor
- Tabs: **Read** (input) | **Write** (output).
- Kind selector: None / Scale / Map / Formula / JSON path.
- Parameter inputs per kind; Map is a key→value list editor.
- **Live preview** for Read using the control's current value; for Write using a
  sample input the user types.

## 5. StatePicker modal

```
StatePicker
├── Filters: adapter instance | room | type | role | search text
├── StateTree (adapter → channel/folder → state), lazily expanded
│   └── leaf: id, name, current value, last-changed (relative)
├── Selection tray (chosen states) + "Add N controls"
```

- **Filters** narrow the tree. Rooms come from `ioBroker.enums` (`enums.get(id)?.rooms`,
  `enums.getList("rooms")`); type/role from `object.common`.
- **Values** (decision: on-demand, no cache pollution): when the visible leaf set changes,
  batch-fetch values with the socket (`getState` per visible id, parallel, capped at the
  page size). Results are held in a picker-local map keyed by id; each entry shows
  `valString` and a relative age from `ts`.
- Leaves are capped/paged (default 200) to bound work; filters reduce the set first.
- Multi-select; auto-suggested feature per state, editable afterwards in the form.

## 6. Transform operations (`src/lib/config/transform-ops.ts`)

Extend `applyRead(v, transform)` / `applyWrite(v, transform)` to run the `read` / `write`
step respectively:

- **scale** — linear map `inMin..inMax → outMin..outMax`, optional `clamp`, optional
  `round` (decimal places).
- **map** — key lookup via `String(v)`; unknown key → pass through.
- **formula** — evaluate `expr` with `x` bound to the value: `new Function("x", "return (" + expr + ")")`.
  Wrapped in try/catch; on error the raw value is used and an error flag is surfaced.
- **jsonpath** — minimal path resolver supporting dot segments and `[n]` indices
  (e.g. `sensors[0].value`), not full JSONPath. **Read-only**: it extracts a value from a
  structured state; for the Write direction the editor offers no JSON-path step (a write
  step has no access to the target object to inject into) and passes the value through.

Contract: the public `applyRead(v, transform)` / `applyWrite(v, transform)` keep their
current signature and return the transformed value (never throw). A separate
`runStep(step, v)` returns `{ value, error? }` and is used by `previewTransform(step, v)`,
which the TransformEditor calls to show a live preview and any error.

## 7. Rendering (Devices page)

`devicesEnrichedStore` resolves each control's `widget` from `DEVICE_FEATURES`. The
Devices page renders by widget: `switch`, `level` (slider), `color`, `value` (read-only),
`enum` (select from `common.states`), `button` (momentary `setState`). Unknown/unavailable
states render as a disabled value row. An inline **Edit** affordance opens the same
`DeviceForm`.

## 8. Files

**Edit**
- `src/lib/types/device.ts` — transform/feature types, `widget` on `EnrichedControl`.
- `src/lib/utils/transform.ts` — new step-based read/write (+ migration helper).
- `src/lib/config/transform-ops.ts` (new) — formula/jsonpath helpers.
- `src/lib/config/features.ts` (new) — feature table + `suggestFeature`.
- `src/lib/components/discovery/StateSelectModal.svelte` → replaced by `StatePicker.svelte` (+ `StateTree.svelte`).
- `src/lib/components/config/DeviceEditor.svelte` → `DeviceForm.svelte` + `ControlRow.svelte`.
- `src/lib/components/config/TransformEditor.svelte` (new).
- `src/lib/picker-values.svelte.js` (new) — on-demand value fetch for the picker.
- `src/routes/config/devices/+page.svelte` — full CRUD host.
- `src/routes/devices/+page.svelte` — widget rendering + inline edit.
- `src/lib/pages.js` — add the Config tab.

All new/edited Svelte components use Svelte 5 runes and TypeScript.

## 9. Error handling
- Missing/unavailable state → control renders disabled with "unavailable".
- Transform error (bad formula/JSON path) → raw value + inline warning; never throws.
- `saveRegistry` failure → console error (existing behaviour); UI stays usable.
- Duplicate state in a device → allowed but flagged in the form.

## 10. Testing
- Vitest unit tests: `applyRead`/`applyWrite` for scale/map/formula/jsonpath (incl. errors),
  the legacy-transform migration, and `suggestFeature`.
- Manual check: add/edit/delete a device, reload, confirm persistence and widget rendering.

## 11. Open questions
_None — resolved during brainstorming (see decisions below)._

### Decisions
- Picker values: on-demand fetch for visible rows (no broad caching).
- Transforms: Scale + Map + Formula + JSON path.
- Features: predefined per device type, auto-suggested from role, changeable.
- Placement: Config tab for full CRUD **and** inline edit on the Devices page.
- Approach: evolve the existing components in place.
