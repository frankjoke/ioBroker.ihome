# Formula Templates — Design Spec

- **Date:** 2026-10-10
- **Status:** Draft (awaiting review)
- **Topic:** A named, reusable library of virtual-state formulas, stored in its own
  setup ID, managed in Settings, and applied from the virtual-state editor modal.

## 1. Goal

Let users save virtual-state formulas as **named templates** and reuse them across
devices without copy/paste. A template carries a name, the expression, and display
metadata. Applying a template copies it into the device's control (the device always
owns its own expression); the control remembers its source template while unmodified so
the link can be shown and cleared on edit.

Motivating example: define the dew point once and apply it to every thermometer.

### Non-goals
- No live-link evaluation: devices hold a copy; editing a template does not retro-change
  devices. (Deleting a template never breaks a device.)
- No dependency resolution between templates or between virtual states (unchanged).
- No per-user or shared/remote template sync — a single setup document.
- No reorder/versioning of templates in v1.

## 2. Data model (`src/lib/types/device.ts`)

```ts
export interface FormulaTemplate {
  id: string;
  name: string;
  expr: string;
  precision?: number;
  unit?: string;
  notes?: string;
}

export interface FormulaLibrary {
  version: number;
  updatedAt: number;
  formulas: FormulaTemplate[];
}
```

`Control` gains an optional provenance field, kept in `projectControl`:

```ts
export interface Control {
  // ...
  virtual?: VirtualSpec;
  formulaId?: string; // source template while unmodified; cleared on edit
}
```

## 3. Storage & seed

- **State ID:** `0_userdata.0.Test.AiHome.formulaList` (a `json` state, same shape as the
  device list at `...deviceList`). Created on first connect if missing. (Movable to the
  adapter namespace later.)
- **Seed:** written **only when the state is absent/empty** — 5 templates:
  1. **Dew point** — real Magnus formula, unit `°C`, precision `1`, notes "needs locals
     temperature(°C), humidity(%)":
     `(237.7 * (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature))) / (17.27 - (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature)))`
  2. **Count low battery** — `count({ role: "value.battery" }, v => v < 20)`
  3. **Any motion active** — `any({ role: "sensor.motion" })`
  4. **Sum of active power** — `sum({ feature: "power" })`, unit `W`
  5. **Average temperature** — `avg({ role: "value.temperature" })`, unit `°C`, precision `1`

## 4. Persistence (`src/lib/formulas.svelte.js`, new)

Mirrors `registry.svelte.js`: `FORMULA_LIST_ID`, `parseLibrary(raw)`,
`ensureFormulaObject()` (creates the state with `type:"json"`), `saveFormulas()`
(debounced 250 ms, echo-suppressed), and `initFormulas()` (waits for the socket, loads
once, subscribes `onUpdate` with echo suppression, and seeds when the state is
absent/empty).

## 5. Store (`src/lib/stores/formulas.svelte.ts`, new)

- `$state` canonical library with `getFormulaLibrary()` / `setFormulaLibrary()`.
- `formulaListStore` — a polling `readable` mirroring `devicesEnrichedStore`.
- `migrateLibrary(raw)` — normalise to `{ version, updatedAt, formulas[] }`, dropping
  malformed entries.
- Mutators `addFormula`, `upsertFormula`, `deleteFormula`, `getFormula` — each bumps
  `version`/`updatedAt` and calls `saveFormulas()`.

## 6. Settings management UI (`src/routes/settings/+page.svelte`)

A **Formula templates** section: a list of rows (name / expression preview / unit / notes)
with **Edit** and **Delete** (confirm), plus an **Add** form (name, expr, precision, unit,
notes). Reuses the existing card/field styles.

## 7. Editor modal & template reuse (`VirtualEditor.svelte` + `ControlRow.svelte`)

`VirtualEditor.svelte` becomes a **modal** (overlay), launched from `ControlRow`:
auto-opened when a virtual control is newly added, otherwise via an **Edit formula**
button. Contents: template `<select>`, expression textarea, precision/unit, variables
legend, helpers reference, live test, and **Save as template** (name prompt →
`addFormula`).

**Reuse semantics (copy-on-select with provenance):**
- Picking a template copies its `expr`/`precision`/`unit` into the control and sets
  `formulaId`.
- `formulaId` is **cleared the moment `expr` no longer equals the source template's
  `expr`** (the control becomes "custom").
- A `formulaId` that no longer resolves to a template is treated as custom and cleaned on
  load.
- Because devices hold a copy, deleting a template leaves every device working.

Pure helpers in `src/lib/config/formulas.ts`: `SEED_TEMPLATES`, `seedLibrary()`,
`applyTemplate(control, template)`, `syncFormulaId(control, library)`.

## 8. Files

**Edit**
- `src/lib/types/device.ts` — `FormulaTemplate`, `FormulaLibrary`, `Control.formulaId`.
- `src/lib/config/project.ts` — keep `formulaId`.
- `src/lib/components/config/ControlRow.svelte` — virtual summary + Edit button; auto-open.
- `src/lib/components/config/VirtualEditor.svelte` — modal + template picker + save-as.
- `src/lib/components/config/DeviceForm.svelte` — signal a freshly added virtual control.
- `src/routes/settings/+page.svelte` — Formula templates CRUD.
- `src/routes/+layout.svelte` — call `initFormulas()` beside `initRegistry()`.

**New**
- `src/lib/formulas.svelte.js` — persistence.
- `src/lib/stores/formulas.svelte.ts` — store + mutators + `migrateLibrary`.
- `src/lib/config/formulas.ts` — pure helpers + seed.
- `src/lib/config/formulas.test.ts`.

All new/edited Svelte components use Svelte 5 runes and TypeScript; no new runtime deps.

## 9. Migration

None required. Existing devices keep their inline `virtual.expr`; `formulaId` is optional
and absent on all current controls. The formula state is created/seeded on first connect.

## 10. Testing

- Vitest (`config/formulas.test.ts`): `SEED_TEMPLATES` has 5 entries incl. the Magnus
  dew-point expression; `migrateLibrary` normalises malformed input; `applyTemplate`
  copies `expr`/`precision`/`unit` and sets `formulaId`; `syncFormulaId` sets when equal,
  clears when `expr` differs, and clears a dangling id.
- Manual (live broker): Settings CRUD; pick Dew point in the modal → live result; edit the
  expression → link clears; Save as template → appears in Settings; delete a template →
  devices keep working.
- Gates: `npm test`, `npm run lint`, `npm run check`, `npm run build`.

## 11. Open questions / decisions

### Decisions
- Reuse model: **copy-on-select** into the device; the device always stores its own
  `expr`; template edits do not propagate.
- Provenance: `formulaId` persisted **while unmodified**, cleared on edit; dangling ids
  cleaned on load.
- Template fields: name + expr + precision + unit + notes.
- Management: **Settings** page CRUD; creation/edit in the **editor modal** with a
  Save-as-template action.
- Storage: a separate setup ID `0_userdata.0.Test.AiHome.formulaList`.
- Approach: a dedicated formula module mirroring the registry pattern (no generic
  setup-doc abstraction until a second consumer exists).
- Seed: 5 examples, dew point uses the **real Magnus formula**.

### Open questions
_None._
