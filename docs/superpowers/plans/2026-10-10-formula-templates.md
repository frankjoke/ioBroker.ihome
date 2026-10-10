# Formula Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A named, reusable library of virtual-state formulas stored in its own setup ID, managed in Settings, and applied from the virtual-state editor modal (copy-on-select with a provenance link).

**Architecture:** A pure module `config/formulas.ts` (seed + `applyTemplate` + `syncFormulaId` + `migrateLibrary`) backs a persistence layer `formulas.svelte.js` (mirrors `registry.svelte.js`) and a store `stores/formulas.svelte.ts`. Settings hosts CRUD; the virtual-state editor becomes a modal with a template picker and Save-as-template. Devices always store their own `expr`; `formulaId` records the source while unmodified.

**Deviation from spec §5:** the spec named a polling `formulaListStore` readable; the plan reads the module `$state` directly in `$derived` (exactly as `devices/+page.svelte` reads `getCanonicalRegistry()`), which is reactive without a poll. Cost if wrong: a component that reads the library outside a reactive context would not update — none do.

**Tech Stack:** Svelte 5 (runes) + TypeScript, Vitest, SvelteKit. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-10-10-formula-templates-design.md`

## Global Constraints

- Svelte 5 runes + TypeScript in new/edited components; **no new runtime dependencies**.
- Reuse existing patterns: persistence mirrors `src/lib/registry.svelte.js`; modals mirror `StatePicker.svelte`; confirmations use `ConfirmModal.svelte`.
- Devices hold a **copy**; deleting a template must never break a device.
- Tests: Vitest, node env, ≥1 assertion each, colocated `*.test.ts`.
- Gates: `npm test`, `npm run lint`, `npm run check`, `npm run build`; then `graphify update .`.
- Windows + bash; scratch under `C:\Users\franz\AppData\Local\Temp\opencode`.

## Review Focus

Failure modes the plan's tests should pin (each has a test in its owning task):

1. `syncFormulaId` clears `formulaId` when the expression no longer matches its template, and when the id no longer resolves. (Task 1)
2. `applyTemplate` copies `expr`/`precision`/`unit` and sets `formulaId`. (Task 1)
3. `migrateLibrary` tolerates a JSON string, a `{val}` wrapper, and malformed/partial entries without throwing. (Task 1)
4. The seed's dew-point template is the real Magnus formula (references `Math.log`), not the linear approximation. (Task 1)
5. Deleting a template leaves existing controls (which keep their `expr`) working — no evaluation path depends on the library. (Task 1 model + Task 4 behavior)

---

### Task 1: Model + pure formula helpers + seed

**Files:**
- Modify: `src/lib/types/device.ts`
- Create: `src/lib/config/formulas.ts`
- Test: `src/lib/config/formulas.test.ts`
- Modify: `src/lib/config/project.ts`
- Modify: `src/lib/config/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FormulaTemplate { id: string; name: string; expr: string; precision?: number; unit?: string; notes?: string }`
  - `FormulaLibrary { version: number; updatedAt: number; formulas: FormulaTemplate[] }`
  - `Control.formulaId?: string`
  - `SEED_TEMPLATES: FormulaTemplate[]`, `seedLibrary(): FormulaLibrary`
  - `applyTemplate(control: Control, template: FormulaTemplate): Control`
  - `syncFormulaId(control: Control, library: FormulaLibrary): Control`
  - `migrateLibrary(raw: unknown): FormulaLibrary`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/config/formulas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SEED_TEMPLATES,
  seedLibrary,
  applyTemplate,
  syncFormulaId,
  migrateLibrary,
} from "$lib/config/formulas";
import type { Control } from "$lib/types/device";

describe("SEED_TEMPLATES", () => {
  it("ships five examples", () => {
    expect(SEED_TEMPLATES).toHaveLength(5);
  });
  it("dew point uses the real Magnus formula", () => {
    const dew = SEED_TEMPLATES.find((t) => t.name === "Dew point");
    expect(dew?.expr).toContain("Math.log");
    expect(dew?.unit).toBe("°C");
    expect(dew?.precision).toBe(1);
  });
});

describe("seedLibrary", () => {
  it("returns a fresh library with the seed templates", () => {
    const lib = seedLibrary();
    expect(lib.formulas).toHaveLength(5);
    expect(lib.version).toBe(0);
  });
});

const tpl = {
  id: "t1",
  name: "Dew point",
  expr: "a - b",
  precision: 1,
  unit: "°C",
  notes: "x",
};

describe("applyTemplate", () => {
  it("copies expr/precision/unit and sets formulaId", () => {
    const c: Control = { id: "c", kind: "virtual", feature: "value", writable: false };
    const out = applyTemplate(c, tpl);
    expect(out.virtual).toEqual({ expr: "a - b", precision: 1 });
    expect(out.unit).toBe("°C");
    expect(out.formulaId).toBe("t1");
  });
});

describe("syncFormulaId", () => {
  const lib = { version: 0, updatedAt: 0, formulas: [tpl] };
  it("keeps formulaId while the expression still matches", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a - b" },
      formulaId: "t1",
    };
    expect(syncFormulaId(c, lib).formulaId).toBe("t1");
  });
  it("clears formulaId when the expression changed", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a + b" },
      formulaId: "t1",
    };
    expect(syncFormulaId(c, lib).formulaId).toBeUndefined();
  });
  it("clears a dangling formulaId", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a - b" },
      formulaId: "gone",
    };
    expect(syncFormulaId(c, lib).formulaId).toBeUndefined();
  });
});

describe("migrateLibrary", () => {
  it("parses a JSON string and keeps well-formed entries", () => {
    const raw = JSON.stringify({
      version: 2,
      formulas: [{ id: "a", name: "A", expr: "1" }, { bad: true }],
    });
    const lib = migrateLibrary(raw);
    expect(lib.version).toBe(2);
    expect(lib.formulas).toHaveLength(1);
    expect(lib.formulas[0].id).toBe("a");
  });
  it("unwraps a { val } state and tolerates garbage", () => {
    expect(migrateLibrary({ val: "{not json" }).formulas).toEqual([]);
    expect(migrateLibrary(null).formulas).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/config/formulas.test.ts`
Expected: FAIL — cannot resolve `$lib/config/formulas`.

- [ ] **Step 3: Add the model types**

In `src/lib/types/device.ts`, add after `VirtualSpec`:

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

Add `formulaId?: string;` to `Control` (after `virtual?`).

- [ ] **Step 4: Implement the pure helpers**

Create `src/lib/config/formulas.ts`:

```ts
import type { Control, FormulaLibrary, FormulaTemplate } from "$lib/types/device";

const DEW_POINT =
  "(237.7 * (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature))) / (17.27 - (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature)))";

export const SEED_TEMPLATES: FormulaTemplate[] = [
  {
    id: "seed-dew-point",
    name: "Dew point",
    expr: DEW_POINT,
    precision: 1,
    unit: "°C",
    notes: "Magnus formula; needs locals temperature (°C) and humidity (%).",
  },
  {
    id: "seed-low-battery",
    name: "Count low battery",
    expr: 'count({ role: "value.battery" }, v => v < 20)',
    notes: "Number of battery states below 20%.",
  },
  {
    id: "seed-any-motion",
    name: "Any motion active",
    expr: 'any({ role: "sensor.motion" })',
  },
  {
    id: "seed-sum-power",
    name: "Sum of active power",
    expr: 'sum({ feature: "power" })',
    unit: "W",
  },
  {
    id: "seed-avg-temp",
    name: "Average temperature",
    expr: 'avg({ role: "value.temperature" })',
    unit: "°C",
    precision: 1,
  },
];

export function seedLibrary(): FormulaLibrary {
  return {
    version: 0,
    updatedAt: Date.now(),
    formulas: SEED_TEMPLATES.map((t) => ({ ...t })),
  };
}

/** Copy a template's expression + display fields onto a control. */
export function applyTemplate(control: Control, template: FormulaTemplate): Control {
  return {
    ...control,
    unit: template.unit,
    formulaId: template.id,
    virtual: {
      ...control.virtual,
      expr: template.expr,
      precision: template.precision,
    },
  };
}

/** Drop formulaId when the template is gone or the expression no longer matches. */
export function syncFormulaId(control: Control, library: FormulaLibrary): Control {
  const id = control.formulaId;
  if (!id) return control;
  const tpl = library.formulas.find((t) => t.id === id);
  if (tpl && tpl.expr === control.virtual?.expr) return control;
  const next = { ...control };
  delete next.formulaId;
  return next;
}

/** Normalise arbitrary persisted data into a FormulaLibrary; never throws. */
export function migrateLibrary(raw: unknown): FormulaLibrary {
  let val: any = raw;
  if (val && typeof val === "object" && "val" in val) val = (val as any).val;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      val = null;
    }
  }
  const formulas: FormulaTemplate[] = Array.isArray(val?.formulas)
    ? val.formulas
        .filter(
          (t: any) => t && typeof t.id === "string" && typeof t.expr === "string",
        )
        .map((t: any) => ({
          id: t.id,
          name: String(t.name ?? t.id),
          expr: t.expr,
          precision: t.precision,
          unit: t.unit,
          notes: t.notes,
        }))
    : [];
  return {
    version: val?.version ?? 0,
    updatedAt: val?.updatedAt ?? Date.now(),
    formulas,
  };
}
```

- [ ] **Step 5: Persist `formulaId`**

In `src/lib/config/project.ts`, add `formulaId: c.formulaId,` to the object returned by `projectControl`.

In `src/lib/config/project.test.ts`, add `formulaId: undefined,` to the first test's expected object (alongside `kind`/`virtual`), and add:

```ts
it("keeps formulaId on a projected control", () => {
  const c: any = { id: "v", feature: "value", writable: false, formulaId: "t1" };
  expect(projectControl(c).formulaId).toBe("t1");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/config/formulas.test.ts src/lib/config/project.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/device.ts src/lib/config/formulas.ts src/lib/config/formulas.test.ts src/lib/config/project.ts src/lib/config/project.test.ts
git commit -m "feat(formulas): model, seed, applyTemplate/syncFormulaId/migrateLibrary"
```

---

### Task 2: Persistence + store + init

**Files:**
- Create: `src/lib/stores/formulas.svelte.ts`
- Create: `src/lib/formulas.svelte.js`
- Modify: `src/routes/+layout.svelte`

**Interfaces:**
- Consumes: `seedLibrary`, `migrateLibrary` (Task 1).
- Produces:
  - `FORMULA_LIST_ID = "0_userdata.0.Test.AiHome.formulaList"`
  - `getFormulaLibrary()`, `setFormulaLibrary(lib)`
  - `getFormulas(): FormulaTemplate[]`, `getFormula(id): FormulaTemplate | undefined`
  - `addFormula(t)`, `upsertFormula(t)`, `deleteFormula(id)`
  - `saveFormulas()`, `initFormulas()`

- [ ] **Step 1: Create the store**

Create `src/lib/stores/formulas.svelte.ts`:

```ts
import type { FormulaLibrary, FormulaTemplate } from "$lib/types/device";

export const FORMULA_LIST_ID = "0_userdata.0.Test.AiHome.formulaList";

const defaultLibrary: FormulaLibrary = {
  version: 0,
  updatedAt: Date.now(),
  formulas: [],
};

let canonicalLibrary = $state<FormulaLibrary>(defaultLibrary);
export function getFormulaLibrary() {
  return canonicalLibrary;
}
export function setFormulaLibrary(lib: FormulaLibrary) {
  canonicalLibrary = lib;
}

export function getFormulas(): FormulaTemplate[] {
  return canonicalLibrary.formulas ?? [];
}
export function getFormula(id: string): FormulaTemplate | undefined {
  return getFormulas().find((t) => t.id === id);
}

function commit(formulas: FormulaTemplate[]) {
  canonicalLibrary = {
    version: (canonicalLibrary.version ?? 0) + 1,
    updatedAt: Date.now(),
    formulas,
  };
}

export function addFormula(t: FormulaTemplate) {
  commit([...getFormulas(), t]);
}
export function upsertFormula(t: FormulaTemplate) {
  commit(
    getFormulas().some((x) => x.id === t.id)
      ? getFormulas().map((x) => (x.id === t.id ? t : x))
      : [...getFormulas(), t],
  );
}
export function deleteFormula(id: string) {
  commit(getFormulas().filter((x) => x.id !== id));
}
```

- [ ] **Step 2: Create the persistence layer**

Create `src/lib/formulas.svelte.js` (mirrors `registry.svelte.js`):

```js
// @ts-nocheck
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  FORMULA_LIST_ID,
  getFormulaLibrary,
  setFormulaLibrary,
} from "$lib/stores/formulas.svelte.ts";
import { migrateLibrary, seedLibrary } from "$lib/config/formulas";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

async function ensureFormulaObject() {
  const obj = await ioBroker.getObject(FORMULA_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", FORMULA_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome formula templates",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveFormulas() {
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getFormulaLibrary());
  saveTimer = setTimeout(() => {
    lastSent = snapshot;
    ioBroker
      .setState(FORMULA_LIST_ID, snapshot)
      .catch((e) => console.error("save formulas:", e));
  }, 250);
}

export function initFormulas() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureFormulaObject();
      } catch (e) {
        console.error("initFormulas ensureFormulaObject:", e);
      }
      const st = await ioBroker.getState(FORMULA_LIST_ID);
      if (st) {
        st.onUpdate = (_cl, state) => {
          const raw = state?.val;
          const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (lastSent !== null && lastSent === asString) return true;
          setFormulaLibrary(migrateLibrary(raw));
          return true;
        };
        const lib = migrateLibrary(st.value);
        if (lib.formulas.length) {
          setFormulaLibrary(lib);
        } else {
          setFormulaLibrary(seedLibrary());
          saveFormulas();
        }
      } else {
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initFormulas:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
```

- [ ] **Step 3: Wire it into the layout**

In `src/routes/+layout.svelte`, import `initFormulas` from `$lib/formulas.svelte.js` and call it in the `onMount` beside `initRegistry()`:

```ts
  onMount(() => {
    initRegistry();
    initFormulas();
    // ...rest unchanged
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/formulas.svelte.ts src/lib/formulas.svelte.js src/routes/+layout.svelte
git commit -m "feat(formulas): persistence + store + init wiring"
```

---

### Task 3: Settings management UI

**Files:**
- Modify: `src/routes/settings/+page.svelte`

**Interfaces:**
- Consumes: `getFormulas`, `addFormula`, `upsertFormula`, `deleteFormula` (Task 2); `saveFormulas` (Task 2); `FormulaTemplate` (Task 1).
- Produces: a "Formula templates" section (list + add/edit + delete).

- [ ] **Step 1: Implement the section**

In `src/routes/settings/+page.svelte`, add to the `<script>`:

```ts
  import {
    getFormulas,
    addFormula,
    upsertFormula,
    deleteFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import type { FormulaTemplate } from "$lib/types/device";

  let editing = $state<FormulaTemplate | null>(null);
  let showForm = $state(false);
  let pendingDelete = $state<FormulaTemplate | null>(null);

  const formulas = $derived(getFormulas());

  function startAdd() {
    editing = { id: crypto.randomUUID(), name: "", expr: "" };
    showForm = true;
  }
  function startEdit(t: FormulaTemplate) {
    editing = { ...t };
    showForm = true;
  }
  function save() {
    if (!editing) return;
    upsertFormula({ ...editing, name: editing.name.trim() || "Untitled" });
    saveFormulas();
    showForm = false;
    editing = null;
  }
  function confirmDelete() {
    if (pendingDelete) {
      deleteFormula(pendingDelete.id);
      saveFormulas();
    }
    pendingDelete = null;
  }
```

Add the section markup after the Appearance card:

```svelte
  <section class="card settings-card">
    <div class="card-header">
      <span class="material-symbols-outlined">functions</span>
      <h2 class="card-title">Formula templates</h2>
    </div>
    <div class="card-body settings-card-body">
      {#if formulas.length === 0}
        <p class="text-muted hint">No templates yet.</p>
      {/if}
      <ul class="formula-list">
        {#each formulas as t (t.id)}
          <li class="formula-row">
            <div class="formula-main">
              <span class="formula-name">{t.name}</span>
              <code class="formula-expr">{t.expr}</code>
              {#if t.unit}<span class="text-muted">{t.unit}</span>{/if}
            </div>
            <div class="formula-actions">
              <button type="button" class="icon-btn" title="Edit" aria-label="Edit" onclick={() => startEdit(t)}>
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button type="button" class="icon-btn" title="Delete" aria-label="Delete" onclick={() => (pendingDelete = t)}>
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </li>
        {/each}
      </ul>
      <button type="button" class="btn btn-primary" onclick={startAdd}>Add template</button>
    </div>
  </section>

  {#if showForm && editing}
    <div class="modal" role="dialog" aria-modal="true" aria-label="Formula template">
      <div class="modal-card card">
        <h3>{editing.name ? "Edit template" : "New template"}</h3>
        <label class="field"><span class="label-mono">Name</span>
          <input type="text" bind:value={editing.name} /></label>
        <label class="field"><span class="label-mono">Expression</span>
          <textarea rows="3" class="mono" bind:value={editing.expr}></textarea></label>
        <div class="form-grid">
          <label class="field"><span class="label-mono">Unit</span>
            <input type="text" bind:value={editing.unit} /></label>
          <label class="field"><span class="label-mono">Precision</span>
            <input type="number" min="0" max="10" value={editing.precision ?? ""}
              oninput={(e) => (editing.precision = e.currentTarget.value === "" ? undefined : Number(e.currentTarget.value))} /></label>
        </div>
        <label class="field"><span class="label-mono">Notes</span>
          <input type="text" bind:value={editing.notes} /></label>
        <div class="actions">
          <button type="button" class="btn" onclick={() => { showForm = false; editing = null; }}>Cancel</button>
          <button type="button" class="btn btn-primary" onclick={save}>Save</button>
        </div>
      </div>
    </div>
  {/if}

  {#if pendingDelete}
    <ConfirmModal title="Delete template" confirmLabel="Delete"
      onConfirm={confirmDelete} onCancel={() => (pendingDelete = null)}>
      <p>Delete <strong>{pendingDelete.name}</strong>? Devices keep their copy.</p>
    </ConfirmModal>
  {/if}
```

Add styles (append to the component `<style>`):

```css
  .formula-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }
  .formula-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }
  .formula-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .formula-name { font-weight: 600; }
  .formula-expr {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40ch;
  }
  .formula-actions { display: flex; gap: 0.35rem; }
  .formula-actions .icon-btn,
  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-card {
    width: min(520px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .modal-card h3 { margin: 0; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings/+page.svelte
git commit -m "feat(formulas): Settings CRUD section"
```

---

### Task 4: Editor modal + ControlRow + DeviceForm

**Files:**
- Modify: `src/lib/components/config/VirtualEditor.svelte`
- Modify: `src/lib/components/config/ControlRow.svelte`
- Modify: `src/lib/components/config/DeviceForm.svelte`

**Interfaces:**
- Consumes: `getFormulas`, `addFormula` (Task 2), `saveFormulas` (Task 2), `applyTemplate`, `syncFormulaId` (Task 1), `getFormula` (Task 2).
- Produces: `VirtualEditor` becomes a modal with props
  `{ control, siblings, onClose, onChange }`; `ControlRow` gains `autoOpen?: boolean` and opens the modal.

- [ ] **Step 1: Make `VirtualEditor` a modal with a template picker**

In `src/lib/components/config/VirtualEditor.svelte`, add to the `<script>`:

```ts
  import {
    getFormulas,
    getFormula,
    addFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import { applyTemplate, syncFormulaId } from "$lib/config/formulas";
```

Add `onClose` to the props:

```ts
  let {
    control,
    siblings,
    onClose,
    onChange,
  }: {
    control: Control;
    siblings: Control[];
    onClose: () => void;
    onChange: (c: Control) => void;
  } = $props();
```

Add the picker + save-as + provenance helpers:

```ts
  const templates = $derived(getFormulas());
  const sourceName = $derived(
    control.formulaId ? (getFormula(control.formulaId)?.name ?? "custom") : "custom",
  );

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) onChange(applyTemplate(control, t));
  }

  let newTemplateName = $state("");
  function saveAsTemplate() {
    const name = newTemplateName.trim() || control.label || "New template";
    const id = crypto.randomUUID();
    addFormula({
      id,
      name,
      expr: control.virtual?.expr ?? "",
      precision: control.virtual?.precision,
      unit: control.unit,
    });
    saveFormulas();
    onChange({ ...control, formulaId: id });
    newTemplateName = "";
  }
```

Change `setExpr` so editing clears the provenance link:

```ts
  function setExpr(expr: string) {
    const next = { ...control, virtual: { ...control.virtual, expr } };
    onChange(syncFormulaId(next, { version: 0, updatedAt: 0, formulas: templates }));
  }
```

Wrap the existing editor markup in a modal overlay (mirroring `StatePicker.svelte`): the outer element becomes

```svelte
<div class="modal" role="dialog" aria-modal="true" aria-label="Virtual state">
  <div class="modal-content">
    <div class="modal-head">
      <h3>Virtual state</h3>
      <button type="button" class="icon-btn" aria-label="Close" onclick={onClose}>
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <!-- existing .virtual-editor content goes here -->
    <div class="template-bar">
      <label class="field">
        <span class="label-mono">Template ({sourceName})</span>
        <select value={control.formulaId ?? ""} onchange={(e) => pickTemplate(e.currentTarget.value)}>
          <option value="">— custom —</option>
          {#each templates as t (t.id)}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
      </label>
      <input type="text" placeholder="new template name" bind:value={newTemplateName} />
      <button type="button" class="btn" onclick={saveAsTemplate}>Save as template</button>
    </div>
  </div>
</div>
```

Add modal styles (mirror `StatePicker`):

```css
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(640px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal-head h3 { margin: 0; }
  .template-bar {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .template-bar .field { flex: 1; }
```

- [ ] **Step 2: Open the modal from `ControlRow`**

In `src/lib/components/config/ControlRow.svelte`, add `autoOpen` to props (default `false`) and an open state:

```ts
  let {
    control,
    deviceType,
    siblings = [],
    autoOpen = false,
    onChange,
    onRemove,
  }: {
    control: Control;
    deviceType: DeviceType;
    siblings?: Control[];
    autoOpen?: boolean;
    onChange: (c: Control) => void;
    onRemove: () => void;
  } = $props();

  let showFormula = $state(false);
  $effect(() => {
    if (autoOpen) showFormula = true;
  });
```

Replace the inline editor block with a summary + button + the modal:

```svelte
  {#if isVirtual}
    <div class="line">
      <span class="text-muted">Formula: {control.virtual?.expr ? "set" : "empty"}</span>
      <button type="button" class="btn" onclick={() => (showFormula = true)}>
        Edit formula
      </button>
    </div>
    {#if showFormula}
      <VirtualEditor
        {control}
        {siblings}
        onClose={() => (showFormula = false)}
        onChange={(c) => onChange(c)}
      />
    {/if}
  {:else if showTransform}
    <TransformEditor ... />
  {/if}
```

- [ ] **Step 3: Auto-open for a freshly added virtual control**

In `src/lib/components/config/DeviceForm.svelte`, track the newly added id:

```ts
  let autoOpenId = $state<string | null>(null);

  function addVirtual() {
    const id = crypto.randomUUID();
    controls = [
      ...controls,
      { id, kind: "virtual", feature: "value", writable: false, label: "", virtual: { expr: "" } },
    ];
    autoOpenId = id;
  }
```

Pass it to `ControlRow`:

```svelte
      <ControlRow
        {control}
        deviceType={type}
        siblings={controls}
        autoOpen={control.id === autoOpenId}
        onChange={(c) => updateControl(i, c)}
        onRemove={() => removeControl(i)}
      />
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `npm run check && npm run build`
Expected: 0 errors; build writes `www/`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/config/VirtualEditor.svelte src/lib/components/config/ControlRow.svelte src/lib/components/config/DeviceForm.svelte
git commit -m "feat(formulas): editor modal with template picker + save-as"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run the suite, lint, check, build**

Run: `npm test && npm run lint && npm run check && npm run build`
Expected: all tests pass; lint clean; 0 errors/0 warnings; build succeeds.

- [ ] **Step 2: Manual smoke test (requires a live ioBroker broker)**

Run: `npm run dev`
- Settings → Formula templates: the 5 seeded templates appear; add/edit/delete works.
- Add a device with temperature + humidity states, *Add virtual state* → the modal opens → pick **Dew point** → live result shows a number; the template name shows in the picker label.
- Edit the expression → the picker label falls back to "custom".
- **Save as template** → the new template appears in Settings.
- Delete a template in Settings → a device using a copy of it keeps computing.

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`
