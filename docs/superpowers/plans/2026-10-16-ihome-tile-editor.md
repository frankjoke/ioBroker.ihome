# iHome Tile Editor (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tile can be edited where it lives: slots (values, badges, icons) with per-slot rules, an
active condition, its own size and background, saved as a per-type template and applied to other
tiles — plus the page/section polish (background editor, icon picker) and the display → editor
Ctrl/Cmd+click routing that leads into it.

**Architecture:** `Placement.tile` (`TileConfig`) stays the only per-tile store and follows Approach A
(A18): the first tile edit **materialises** the tile — a complete `{template, size, slots}` copied
from the device → template → preset chain; a tile is materialised iff it has `slots`. After that it
diverges independently and the renderer reads it verbatim; **Reset** drops `tile` and returns to the
chain. Every mutation is a pure function (`tile-ops`, `template-ops`, `layout-ops`) committed through
the store's single write path (`commitLayout`); templates have their own registry and write path
(`commitTemplates`). Raw-state slots get pseudo-controls and are registered as used state ids like
device slots.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, vitest for pure logic, live checks in the
browser against the real broker (192.168.178.9).

**Spec:** `docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md` (decisions A18–A30)

## Global Constraints

- Branch `feature/ihome-display` (spec commits `83ef1a7`, `a40fe4e`). Nothing is pushed; no packaging.
- No new runtime or dev dependencies. No new services.
- Svelte 5 runes only: `$state`/`$derived`/`$effect`/`$props`, `onclick={}`; no `export let`,
  no `svelte/store`, no `on:click`.
- Every new **pure** function gets a vitest test in the house style: `import { it, expect } from "vitest"`,
  a small local factory helper, no fixtures, no component harness. Component/store behaviour is
  proven by the **live check** instead.
- One write path per document: `commitLayout(next)` for `pageList`, `commitTemplates(next)` for
  `templateList`; a component never calls `ioBroker.setState` directly. Every tile **content** edit
  goes through `tile-ops` (`editTile` for slots/rules/size/background/active, `applyTemplate` for a
  template apply) so materialisation happens in exactly one place.
- Documents are never overwritten while unreadable (`isLayoutWritable` / `isTemplatesWritable`).
- Keep `cwd` at the repo root for `svelte-check`/`eslint` (a `.svelte-kit/` inside `src/` throws
  phantom lint errors).
- Gates before each commit that touches `src/`: `npm test` (all pass), `npm run check` (**0 errors
  0 warnings**), `npm run lint` (**0 errors**). `npm run build` before the slice is done.
- Live checks: `npm run dev`, open the app port the terminal prints (never reuse a remembered one),
  set `localStorage["__VISUAL__:hostPort"] = "\"192.168.178.9:8081\""` — the value is **JSON**, so
  the quotes are part of it. Broker documents: `0_userdata.0.Test.AiHome.pageList` (version 1, the
  user's real data — additive changes only) and `0_userdata.0.Test.AiHome.templateList` (currently
  absent; written only by a template save).
- After each committed task run `graphify update .` (AST-only, no API cost).
- The working tree must be clean before Task 1. Every task commits only its own files.

## Review Focus

The five inputs/conditions the spec implies but no unit test can fully pin — each gets its check in
the owning task:

1. **Hand-written / odd documents**: an unknown `active.op`, a `showWhen` value that is neither
   "active" nor "inactive", an `active` without a source, `slots: []` (materialised with zero slots),
   a dangling device on a materialised tile — everything must degrade, nothing may throw —
   Tasks 1, 2, 4, 10.
2. **An unreadable `templateList`** (garbage value in the state): the save path must refuse and the
   pane must say so, and a later good save may not silently replace it — Task 5 (unit) + Task 16
   (live).
3. **Icon strings that are neither a symbol nor a URL** (spaces, empty, mixed case, a bare word with
   a dot): they render as symbol text, never as a broken `<img>` — Task 6 (unit) + Task 12 (live).
4. **Dormancy must not shift other slots**: a state-hidden or hint-failed slot must not claim "the
   next free control" in the positional walk — Task 3 (unit) + Task 9 (live: a Thermometer without
   humidity loses exactly one row and the other rows keep their values).
5. **Materialisation edges**: a legacy partial `tile` (`{size}` only) keeps its size on first edit;
   `slots: []` counts as materialised; Reset drops the whole tile — Tasks 1/2 (unit) + Task 16 (live).

---

## File Structure

| file | responsibility |
|---|---|
| `src/lib/types/display.ts` | `ActiveOp`, `ActiveCondition`, `TileConfig.active`/`background`, `Slot.showWhen`, `Template.background` |
| `src/lib/types/device.ts` | `SlotControl` — the minimum a slot renderer reads off a control (pseudo-controls included) |
| `src/lib/utils/json.ts` *(new)* | `deepCopy` — the one JSON-safe deep copy the config ops share |
| `src/lib/utils/icon-url.ts` *(new)* | `isImageIcon`, `iconUrl`, `collectDocumentIcons` |
| `src/lib/assets/material-symbol-names.json` *(new)* | the material-symbols name list (fetched once, committed) |
| `src/lib/config/tile-ops.ts` *(new)* | `materialiseTile`, `ensureTile`, `resetTile`, slot/rule ops, `editTile`, `evalActive`, `templateFromTile`, `upsertTemplate`, `applyTemplate` |
| `src/lib/config/template-ops.ts` | `pickSlotControls`, `slotVisible`, `pickable`, free-text hints in `pickControl` |
| `src/lib/config/layout-ops.ts` | `mapPlacement`, `parseLayoutRef` (generalises `parsePlacementRef`), deep-copied `clonePlacement` |
| `src/lib/config/appearance.ts` | `gradientValue`, `inspectGradient`, `isHexColor` |
| `src/lib/config/rule-ops.ts` | export the existing `truthy`; an optional raw resolver for badges |
| `src/lib/stores/templates.svelte.ts` | `commitTemplates`, `isTemplatesWritable`, `getTemplateSaveFailed` |
| `src/lib/stores/pages.svelte.ts` | `registerSlotStateIds` (raw slot sources and active conditions subscribe) |
| `src/lib/pages.js` | `requestLayoutConfig` / `takeRequestedLayout` (generalises the placement handoff) |
| `src/lib/components/common/Icon.svelte` *(new)* | symbol glyph vs `<img>`, one component for every icon in the app |
| `src/lib/components/common/IconPicker.svelte` *(new)* | symbols / document / broker / URL tabs |
| `src/lib/components/common/BackgroundEditor.svelte` *(new)* | solid / gradient / image with pickers and preview |
| `src/lib/components/layout/SlotPicker.svelte` *(new)* | device controls / placeholder / any state; `slot` and `source` modes |
| `src/lib/components/display/Tile.svelte` | slots from the materialised tile, raw states, active condition, chart background |
| `src/lib/components/display/SlotRenderer.svelte`, `slots/*` | `SlotControl` props, `Icon` |
| `src/lib/components/display/GroupSection.svelte` | Ctrl/Cmd+click the header → editor |
| `src/lib/components/AppBar.svelte` | `Icon` tabs, Ctrl/Cmd+click a page tab → editor, M3 stale-tab fix |
| `src/lib/components/layout/LayoutTree.svelte` | tile-row `+`, `Icon` rows, fold-everything-except (handoff focus) |
| `src/lib/components/layout/LayoutDetails.svelte` | the tile editor pane (general options, templates, slots, rules) + page/section polish |
| `src/routes/layout/+page.svelte` | slot-picker and device-swap dialogs, handoff focus, selection follow |

---

### Task 1: Model + materialise contract

**Files:**
- Modify: `src/lib/types/display.ts`
- Create: `src/lib/utils/json.ts`
- Create: `src/lib/config/tile-ops.ts`
- Test: `src/lib/config/tile-ops.test.ts` *(new)*

**Interfaces:**
- Consumes: nothing.
- Produces (exact names every later task uses):

```ts
// display.ts
export type ActiveOp = "truthy" | "gt" | "gte" | "lt" | "lte" | "eq" | "ne";

export interface ActiveCondition {
  /** A device control (feature → id → stateId → label), a placeholder hint, or a raw state id. */
  source: string;
  op: ActiveOp;
  /** The right-hand side; unused by `truthy`. Stored as text, compared loosely. */
  value?: string;
}
// TileConfig gains:  background?: Background;  active?: ActiveCondition;
// Slot gains:        showWhen?: "active" | "inactive";   (absent = both)
// Template gains:    background?: Background;

// utils/json.ts
/** JSON-safe deep copy: every config document is JSON, and the store's $state
 *  proxies cannot be structured-cloned. */
export function deepCopy<T>(value: T): T;   // `undefined` passes through

// tile-ops.ts
export function materialiseTile(device: Device, templates: Template[]): TileConfig;
export function ensureTile(
  placement: Placement,
  device: Device,
  templates: Template[],
): Placement & { tile: TileConfig };
export function resetTile(placement: Placement): Placement;
```

- [ ] **Step 1: Write the failing tests** (`src/lib/config/tile-ops.test.ts`)

```ts
import { it, expect } from "vitest";
import type { Device } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import { ensureTile, materialiseTile, resetTile } from "./tile-ops";

const device = (over: Partial<Device> = {}): Device =>
  ({
    id: "d1",
    type: "Switch",
    name: "Pumpe",
    controls: [],
    ...over,
  }) as Device;

const userTemplate = (over: Partial<Template> = {}): Template =>
  ({ id: "t1", name: "Pump", type: "Switch", slots: [{ kind: "value", source: "power", rules: [{ when: "power > 0", glow: true }] }], ...over }) as Template;

it("materialises a tile from the chain: template id, size and a deep-copied slot list", () => {
  const t = userTemplate();
  const tile = materialiseTile(device({ template: "t1" }), [t]);
  expect(tile.template).toBe("t1");
  expect(tile.slots).toEqual(t.slots);
  expect(tile.slots?.at(0)).not.toBe(t.slots.at(0));
  expect(tile.slots?.at(0)?.rules?.at(0)).not.toBe(t.slots.at(0)?.rules?.at(0));
});

it("materialising without a template names the type preset", () => {
  expect(materialiseTile(device(), []).template).toBe("Switch");
});

it("ensureTile leaves a materialised placement alone and keeps a legacy size", () => {
  const materialised = { id: "p", device: "d1", tile: { size: { w: 2 as const, h: 1 as const }, slots: [] } };
  expect(ensureTile(materialised, device(), [])).toBe(materialised);

  const legacy = { id: "p", device: "d1", tile: { size: { w: 2 as const, h: 1 as const } } };
  const ensured = ensureTile(legacy, device(), []);
  expect(ensured.tile.size).toEqual({ w: 2, h: 1 });
  expect(Array.isArray(ensured.tile.slots)).toBe(true);
});

it("ensureTile materialises from nothing and resetTile drops the whole tile", () => {
  const bare = { id: "p", device: "d1" };
  const ensured = ensureTile(bare, device(), []);
  expect(ensured.tile.slots!.length).toBeGreaterThan(0);
  expect(resetTile(ensured)).toEqual(bare);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/config/tile-ops.test.ts`
Expected: FAIL — cannot resolve `./tile-ops`.

- [ ] **Step 3: Implement**

`display.ts`: add the two fields to `TileConfig`, `showWhen` to `Slot`, `background` to `Template`,
plus the `ActiveOp`/`ActiveCondition` types (one doc line each, matching the file's style).

`utils/json.ts`: the `deepCopy` from the Interfaces block.

`tile-ops.ts`:

```ts
import type { Device } from "$lib/types/device";
import type { Placement, TileConfig, Template } from "$lib/types/display";
import { presetForType, resolveTemplate } from "$lib/config/template-ops";
import { deepCopy } from "$lib/utils/json";

export function materialiseTile(device: Device, templates: Template[]): TileConfig {
  const resolved = resolveTemplate(device, templates);
  return {
    template: device.template ?? presetForType(device.type).id,
    size: { ...resolved.size },
    slots: deepCopy(resolved.slots),
  };
}

export function ensureTile(
  placement: Placement,
  device: Device,
  templates: Template[],
): Placement & { tile: TileConfig } {
  if (placement.tile?.slots) return placement as Placement & { tile: TileConfig };
  const base = materialiseTile(device, templates);
  return {
    ...placement,
    // The legacy partial's own fields win (its size survives); `slots` is
    // re-pinned because a partial never carries one (the early return did).
    tile: { ...base, ...(placement.tile ?? {}), slots: base.slots },
  };
}
```

```ts
export function resetTile(placement: Placement): Placement {
  const { tile: _drop, ...rest } = placement;
  return rest;
}
```

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run src/lib/config/tile-ops.test.ts` → PASS · `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/display.ts src/lib/utils/json.ts src/lib/config/tile-ops.ts src/lib/config/tile-ops.test.ts
git commit -m "feat(tiles): the tile config model and the materialise contract (A18)"
```

---

### Task 2: Slot and rule ops + `editTile`

**Files:**
- Modify: `src/lib/config/tile-ops.ts`, `src/lib/config/layout-ops.ts` (export `mapPlacement`)
- Test: `src/lib/config/tile-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 (`materialiseTile`, `ensureTile`, `deepCopy`), `moveItem` (layout-ops).
- Produces:

```ts
// layout-ops.ts
export function mapPlacement(
  reg: PageRegistry, pageId: string, sectionId: string, placementId: string,
  fn: (placement: Placement) => Placement,
): PageRegistry;

// tile-ops.ts — every op returns a new TileConfig (input never mutated)
export function addSlot(tile: TileConfig, slot: Slot, at?: number): TileConfig;
export function removeSlot(tile: TileConfig, index: number): TileConfig;
export function moveSlot(tile: TileConfig, from: number, to: number): TileConfig;
export function patchSlot(tile: TileConfig, index: number, patch: Partial<Slot>): TileConfig;
export function addRule(tile: TileConfig, slotIndex: number, rule: Rule, at?: number): TileConfig;
export function patchRule(tile: TileConfig, slotIndex: number, ruleIndex: number, patch: Partial<Rule>): TileConfig;
export function removeRule(tile: TileConfig, slotIndex: number, ruleIndex: number): TileConfig;
export function moveRule(tile: TileConfig, slotIndex: number, from: number, to: number): TileConfig;

/** The pane's and the tree's one way to edit a tile: materialise once, then apply
 *  `fn` to its own config. Unknown addresses return the registry untouched. */
export function editTile(
  reg: PageRegistry, anchor: PlacementAnchor, device: Device, templates: Template[],
  fn: (tile: TileConfig) => TileConfig,
): PageRegistry;
```

- [ ] **Step 1: Write the failing tests** (append to `tile-ops.test.ts`)

```ts
it("slot ops keep order, copy the tile and bail out on bad indexes", () => {
  const tile: TileConfig = { slots: [{ kind: "value", source: "a" }] };
  const two = addSlot(tile, { kind: "badge", options: { badge: "battery" } });
  expect(two.slots?.length).toBe(2);
  expect(tile.slots?.length).toBe(1); // input untouched
  const reordered = moveSlot(two, 0, 1);
  expect(reordered.slots?.map((s) => s.source ?? "badge")).toEqual(["badge", "a"]);
  expect(moveSlot(two, 0, 9).slots).toEqual(two.slots); // out-of-range: a copy, no throw
  expect(patchSlot(two, 0, { label: "Leistung" }).slots?.at(0)?.label).toBe("Leistung");
  expect(removeSlot(two, 0).slots?.length).toBe(1);
});

it("rule ops address slot and rule indexes", () => {
  const tile: TileConfig = { slots: [{ kind: "value", source: "a" }] };
  const one = addRule(tile, 0, { when: "power > 0", glow: true });
  const two = addRule(one, 0, { when: "power > 100", icon: "bolt" });
  expect(two.slots?.at(0)?.rules?.length).toBe(2);
  expect(patchRule(two, 0, 1, { icon: "flash_on" }).slots?.at(0)?.rules?.at(1)?.icon).toBe("flash_on");
  expect(moveRule(two, 0, 1, 0).slots?.at(0)?.rules?.at(0)?.icon).toBe("bolt");
  expect(removeRule(two, 0, 0).slots?.at(0)?.rules?.length).toBe(1);
  expect(patchRule(two, 3, 0, {}).slots).toEqual(two.slots); // bad slot index: unchanged
});

it("editTile materialises once, applies the op and leaves siblings alone", () => {
  const reg = {
    version: 1, updatedAt: 0,
    pages: [{ id: "p", title: "P", groups: [{ id: "g", title: "G", tiles: [
      { id: "t1", device: "d1" }, { id: "t2", device: "d1" },
    ] }] }],
  } as PageRegistry;
  const next = editTile(reg, { pageId: "p", sectionId: "g", placementId: "t1" }, device(), [],
    (t) => addSlot(t, { kind: "value", source: "power" }));
  expect(next.updatedAt).toBeGreaterThan(0);
  const tiles = next.pages[0].groups[0].tiles!;
  expect(tiles[0].tile?.slots?.some((s) => s.source === "power")).toBe(true);
  expect(tiles[1].tile).toBeUndefined();               // sibling untouched
  expect(reg.pages[0].groups[0].tiles![0].tile).toBeUndefined(); // input untouched
  // A stale address changes nothing (the registry wrapper is new, the pages equal).
  expect(editTile(reg, { pageId: "nope", sectionId: "g", placementId: "t1" }, device(), [], (t) => t).pages).toEqual(reg.pages);
});
```

- [ ] **Step 2: Run and watch them fail** — `npx vitest run src/lib/config/tile-ops.test.ts` → FAIL, `addSlot` etc. not exported.

- [ ] **Step 3: Implement**

`layout-ops.ts`: export `mapPlacement` (wrap `mapSection` like `patchPlacement` does — and rewrite
`patchPlacement` to use it, so there is one address walker).

`tile-ops.ts`: all ops are `{ ...tile, slots: copied.map(...) }` with `moveItem` for reorders and
`index`-bounds bailouts that return a copy of the untouched list (same style as `moveItem`).
`editTile` uses `mapPlacement` + `ensureTile` + `fn`.

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test` all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/tile-ops.ts src/lib/config/tile-ops.test.ts src/lib/config/layout-ops.ts
git commit -m "feat(tiles): slot and rule ops with the single editTile write path"
```

---

### Task 3: Slot resolution semantics — `pickSlotControls`, `slotVisible`, free-text hints

**Files:**
- Modify: `src/lib/config/template-ops.ts`
- Test: `src/lib/config/template-ops.test.ts`

**Interfaces:**
- Consumes: `Slot`, existing `pickControl`/`resolveControl`.
- Produces:

```ts
export interface PickedSlot<T> {
  slot: Slot;
  control?: T;
  /** The slot named a source or a hint and nothing matched (A20) — never
   *  positional, because a wrong reading is worse than a missing one. */
  dormant?: boolean;
}

/** May this slot render, given the tile's state? Unknown values count as both. */
export function slotVisible(slot: Slot, active: boolean): boolean;

/** The shape a hint matches against: role, then label, then unit. */
export function pickable<T extends PickableControl>(controls: T[]): Pickable[];

export interface PickableControl extends Pickable {
  id?: string;
  feature?: string;
  object?: { common?: { role?: string } };
  common?: { role?: string };
}

/**
 * One pass over a tile's slots in order: state-hidden slots drop out first (they
 * must not claim "the next free control"), then `source`, then a hint, then the
 * next control no earlier slot used. `options.raw` supplies the pseudo-control
 * for a source that is a raw state id.
 */
export function pickSlotControls<T extends PickableControl>(
  slots: Slot[],
  controls: T[],
  options?: { active?: boolean; raw?: (source: string) => T | undefined },
): PickedSlot<T>[];
```

`pickControl` gains the free-text generalisation: `PICK_HINTS[hint.toLowerCase()] ?? { roles: [hint],
words: [hint], units: [] }` (trimmed, lowercased for the lookup; the unit pass stays an exact match).

- [ ] **Step 1: Write the failing tests** (append to `template-ops.test.ts`)

```ts
const ctl = (id: string, over: Record<string, unknown> = {}) => ({ id, ...over });

it("pickSlotControls walks in order and never hands one control to two slots", () => {
  const slots: Slot[] = [{ kind: "value" }, { kind: "value" }];
  const out = pickSlotControls(slots, [ctl("a"), ctl("b")]);
  expect(out.map((r) => r.control?.id)).toEqual(["a", "b"]);
});

it("a failing hint goes dormant and does not claim a control", () => {
  const slots: Slot[] = [{ kind: "value", options: { pick: "humidity" } }, { kind: "value" }];
  const out = pickSlotControls(slots, [ctl("a", { unit: "°C" })]);
  expect(out[0]).toMatchObject({ dormant: true });
  expect(out[0].control).toBeUndefined();
  expect(out[1].control?.id).toBe("a"); // positional slot still gets the first control
});

it("a free-text hint matches role, label or unit", () => {
  const slots: Slot[] = [{ kind: "value", options: { pick: "Luftfeuchtigkeit" } }];
  const out = pickSlotControls(slots, [ctl("h", { label: "Luftfeuchtigkeit", unit: "%" })]);
  expect(out[0].control?.id).toBe("h");
});

it("state-hidden slots drop out before the positional walk", () => {
  const slots: Slot[] = [
    { kind: "value", showWhen: "active" },
    { kind: "value" },
  ];
  const out = pickSlotControls(slots, [ctl("a")], { active: false });
  expect(out.length).toBe(1);
  expect(out[0].control?.id).toBe("a"); // not consumed by the hidden slot
});

it("a raw source resolves through the raw callback", () => {
  const raw = (source: string) => (source === "0_userdata.0.x" ? ctl("raw", { stateId: source }) : undefined);
  const out = pickSlotControls([{ kind: "value", source: "0_userdata.0.x" }], [], { raw });
  expect(out[0].control?.id).toBe("raw");
  const missing = pickSlotControls([{ kind: "value", source: "nope" }], [], { raw });
  expect(missing[0]).toMatchObject({ dormant: true });
});

it("unknown showWhen counts as both and slotVisible keeps icon slots visible", () => {
  expect(pickSlotControls([{ kind: "value", showWhen: "garbage" as any }], [ctl("a")]).length).toBe(1);
  expect(slotVisible({ kind: "icon" }, false)).toBe(true);
});
```

- [ ] **Step 2: Run and watch them fail** → `npx vitest run src/lib/config/template-ops.test.ts -t "pickSlotControls"`.

- [ ] **Step 3: Implement**

Move the `pickable` mapping out of `Tile.svelte` (lines ~69-76) into `template-ops.ts`; implement
`slotVisible` (`"active"` → `active`, `"inactive"` → `!active`, anything else → `true`) and
`pickSlotControls` per the algorithm in the doc comment. Badge slots are skipped (`kind === "badge"`),
exactly as the current pass does.

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test` all pass (the existing
`pickControl` tests must stay green — the curated hints still win).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/template-ops.ts src/lib/config/template-ops.test.ts
git commit -m "feat(tiles): one slot resolution pass — hints, dormancy, state visibility"
```

---

### Task 4: `evalActive`

**Files:**
- Modify: `src/lib/config/rule-ops.ts` (export `truthy`), `src/lib/config/tile-ops.ts`
- Test: `src/lib/config/tile-ops.test.ts`

**Interfaces:**
- Produces:

```ts
/**
 * The tile's active reading: `truthy` uses the app's on/off reading; the
 * comparisons go numeric when both sides parse as finite numbers and otherwise
 * compare case-insensitively as text. No condition, an unknown op or a missing
 * value is never active.
 */
export function evalActive(cond: ActiveCondition | undefined, value: unknown): boolean;
```

- [ ] **Step 1: Write the failing tests** (append to `tile-ops.test.ts`)

```ts
it("evalActive — truthy is the on/off reading", () => {
  const c = (op: ActiveOp, value?: string): ActiveCondition => ({ source: "s", op, value });
  expect(evalActive(c("truthy"), true)).toBe(true);
  expect(evalActive(c("truthy"), "1")).toBe(true);
  expect(evalActive(c("truthy"), 0)).toBe(false);
  expect(evalActive(undefined, true)).toBe(false);
});

it("evalActive — numeric comparisons when both sides are numbers", () => {
  expect(evalActive({ source: "s", op: "gt", value: "20" }, 22.5)).toBe(true);
  expect(evalActive({ source: "s", op: "gt", value: "20" }, "22.5")).toBe(true);
  expect(evalActive({ source: "s", op: "gte", value: "20" }, "20.0")).toBe(true);
  expect(evalActive({ source: "s", op: "lt", value: "20" }, 19)).toBe(true);
  expect(evalActive({ source: "s", op: "eq", value: "20" }, "20.0")).toBe(true);
  expect(evalActive({ source: "s", op: "ne", value: "20" }, "20")).toBe(false);
});

it("evalActive — text fallback is case-insensitive; junk degrades", () => {
  expect(evalActive({ source: "s", op: "eq", value: "Auto" }, "auto")).toBe(true);
  expect(evalActive({ source: "s", op: "eq", value: "auto" }, "manual")).toBe(false);
  expect(evalActive({ source: "s", op: "gt", value: "b" }, "c")).toBe(true);
  expect(evalActive({ source: "s", op: "gt" }, 5)).toBe(false);              // no value
  expect(evalActive({ source: "s", op: "wat" as any, value: "1" }, "1")).toBe(false); // unknown op
  expect(evalActive({ source: "s", op: "eq", value: "" }, "")).toBe(true);   // empty is text, not a number
  expect(evalActive({ source: "s", op: "eq", value: "0" }, "")).toBe(false); // "" must not parse as 0
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

Export the existing `truthy` from `rule-ops.ts:133` and import it in `tile-ops.ts` (do not add a
third copy). Implementation: op switch; for the comparison ops guard `right !== undefined`, build
`left`/`right` strings, parse both with `Number` only when both are non-empty (and the raw value is
not `null`/`undefined`); numeric branch when both are finite, else lowercase string compare with
`===`/`!==`/`<`/`>`/`<=`/`>=`.

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/rule-ops.ts src/lib/config/tile-ops.ts src/lib/config/tile-ops.test.ts
git commit -m "feat(tiles): evalActive — the tile's active condition over live values"
```

---

### Task 5: Templates — `templateFromTile`, `upsertTemplate`, `applyTemplate` + the writable registry

**Files:**
- Modify: `src/lib/config/tile-ops.ts`, `src/lib/stores/templates.svelte.ts`
- Test: `src/lib/config/tile-ops.test.ts`

**Interfaces:**
- Produces:

```ts
// tile-ops.ts
/** The tile's layout as a per-type template: size + slots + CSS background; the
 *  type's features come from the chain, `active` stays on the tile (A19). */
export function templateFromTile(
  tile: TileConfig, device: Device, templates: Template[], name: string,
): Template;

/** Append, or replace the template with the same (name, type) keeping its id. */
export function upsertTemplate(registry: TemplateRegistry, template: Template): TemplateRegistry;

/** Replace the placement's size, slots and background with the template's; the
 *  tile's own active condition survives. */
export function applyTemplate(placement: Placement, template: Template): Placement;

// stores/templates.svelte.ts
export function commitTemplates(next: TemplateRegistry): boolean;
export function isTemplatesWritable(): boolean;      // false while pending or unreadable
export function getTemplateSaveFailed(): boolean;
```

- [ ] **Step 1: Write the failing tests** (append to `tile-ops.test.ts`)

```ts
it("templateFromTile copies, never shares: mutating the tile leaves the template alone", () => {
  const tile: TileConfig = { size: { w: 2, h: 2 }, background: { kind: "solid", value: "#101418" }, slots: [{ kind: "value", source: "power", rules: [{ when: "power > 0" }] }] };
  const t = templateFromTile(tile, device({ type: "Switch" }), [], "  Pumpe  ");
  expect(t.name).toBe("Pumpe");
  expect(t.type).toBe("Switch");
  tile.slots![0].source = "mutated";
  expect(t.slots[0].source).toBe("power");
  expect(t.slots[0]).not.toBe(tile.slots![0]);
});

it("upsertTemplate appends once, then overwrites by name+type keeping the id", () => {
  const empty: TemplateRegistry = { version: 0, updatedAt: 0, templates: [] };
  const one = upsertTemplate(empty, userTemplate({ id: "a", name: "Pump" }));
  expect(one.version).toBe(1);
  const two = upsertTemplate(one, userTemplate({ id: "b", name: "Pump", slots: [{ kind: "icon" }] }));
  expect(two.templates.length).toBe(1);
  expect(two.templates[0].id).toBe("a");
  expect(two.templates[0].slots).toEqual([{ kind: "icon" }]);
  const otherType = upsertTemplate(two, userTemplate({ id: "c", name: "Pump", type: "Light" }));
  expect(otherType.templates.length).toBe(2);
});

it("applyTemplate replaces size, slots and background but keeps the active condition", () => {
  const placement: Placement = {
    id: "p", device: "d1",
    title: "Garten",
    tile: { size: { w: 1, h: 1 }, background: { kind: "solid", value: "#000" }, active: { source: "power", op: "truthy" }, slots: [{ kind: "value", source: "old" }] },
  };
  const next = applyTemplate(placement, userTemplate({ id: "t9", background: { kind: "solid", value: "#111" }, slots: [{ kind: "value", source: "new" }] }));
  expect(next.title).toBe("Garten");
  expect(next.tile?.template).toBe("t9");
  expect(next.tile?.slots).toEqual([{ kind: "value", source: "new" }]);
  expect(next.tile?.background?.value).toBe("#111");
  expect(next.tile?.active?.source).toBe("power");
  const bare = applyTemplate(placement, userTemplate({ id: "t9", slots: [] }));
  expect(bare.tile?.background).toBeUndefined(); // the template has none: the old one drops
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement `tile-ops` templates + the store**

`templateFromTile` / `upsertTemplate` / `applyTemplate` per the Interfaces block (`newId()` from
`$lib/utils/ids` for the new id; `deepCopy` for every copied subtree).

`templates.svelte.ts`, mirroring `pages.svelte.ts`:
- `let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">("pending")`; set it in
  `initTemplates` (`!st` → `"absent"`, parsed → `"loaded"`, unparseable non-empty value →
  `"unreadable"`, keep the console error).
- `commitTemplates(next)`: refuse with a console error when `!isTemplatesWritable()`, else
  `setTemplateRegistry(next); saveTemplates(); return true`.
- `saveTemplates`: store `saveFailed = true` when `!ioBroker.connected` (the I1 lesson) and on catch,
  `false` on success; export `getTemplateSaveFailed`.

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/tile-ops.ts src/lib/config/tile-ops.test.ts src/lib/stores/templates.svelte.ts
git commit -m "feat(tiles): per-type templates — save, upsert, apply, and a writable registry"
```

---

### Task 6: `icon-url.ts` — image vs symbol, plus `collectDocumentIcons`

**Files:**
- Create: `src/lib/utils/icon-url.ts`
- Test: `src/lib/utils/icon-url.test.ts` *(new)*

**Interfaces:**
- Produces:

```ts
/** Is this icon value an image (URL, root-relative path, broker-relative path
 *  like `adapter/name.png`) rather than a material-symbols name? */
export function isImageIcon(raw: string | undefined): boolean;

/** The `src` for an image icon (root-relative values get the leading slash). */
export function iconUrl(raw: string | undefined): string;

/** Every `icon` string anywhere in the two documents, deduped and sorted — the
 *  picker's "document" tab. */
export function collectDocumentIcons(reg: PageRegistry, templates: TemplateRegistry): string[];
```

- [ ] **Step 1: Write the failing test**

```ts
it("classifies symbols vs images", () => {
  expect(isImageIcon("lightbulb")).toBe(false);
  expect(isImageIcon("power_settings_new")).toBe(false);
  expect(isImageIcon("")).toBe(false);
  expect(isImageIcon(undefined)).toBe(false);
  expect(isImageIcon("https://x/y.png")).toBe(true);
  expect(isImageIcon("//x/y.svg")).toBe(true);
  expect(isImageIcon("data:image/svg+xml;base64,AAA")).toBe(true);
  expect(isImageIcon("/icons/a.png")).toBe(true);
  expect(isImageIcon("adapter/thing.png")).toBe(true);
  expect(isImageIcon("adapter/thing")).toBe(true);      // broker-relative path
  expect(isImageIcon("two words")).toBe(false);         // not a path, not a symbol - rendered as text
});

it("iconUrl leaves absolutes alone and roots the rest", () => {
  expect(iconUrl("https://x/y.png")).toBe("https://x/y.png");
  expect(iconUrl("/icons/a.png")).toBe("/icons/a.png");
  expect(iconUrl("adapter/thing.png")).toBe("/adapter/thing.png");
});

it("collectDocumentIcons gathers every icon field, deduped", () => {
  const reg = { version: 1, updatedAt: 0, pages: [{ id: "p", title: "P", icon: "home", groups: [
    { id: "g", title: "G", icon: "home", tiles: [{ id: "t", device: "d", tile: { slots: [{ kind: "icon", options: { icon: "bolt" }, rules: [{ icon: "flash_on" }] }] } }] },
  ] }] } as PageRegistry;
  const tpl = { version: 1, updatedAt: 0, templates: [{ id: "t1", name: "T", type: "Switch" as const, slots: [{ kind: "icon", options: { icon: "bolt" } }] }] } as TemplateRegistry;
  expect(collectDocumentIcons(reg, tpl)).toEqual(["bolt", "flash_on", "home"]);
});
```

- [ ] **Step 2: Run and watch it fail** → `npx vitest run src/lib/utils/icon-url.test.ts`.

- [ ] **Step 3: Implement**

`isImageIcon`: trimmed, empty → false; `^(https?:)?//`, `^data:`, leading `/`, an image extension
(`/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)([?#].*)?$/i`), or any `/` in the value → true.
`iconUrl`: empty → `""`; absolute/data/leading-slash → as is; else `` `/${value}` ``.
`collectDocumentIcons`: walk both documents, collect every string under a key named `icon` (object
keys are the only places icons live: page, group, slot options, rules, templates), Set → sorted array.

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/icon-url.ts src/lib/utils/icon-url.test.ts
git commit -m "feat(icons): image vs symbol resolution and the document icon scan"
```

---

### Task 7: `appearance.ts` — gradient builder + inspector

**Files:**
- Modify: `src/lib/config/appearance.ts`
- Test: `src/lib/config/appearance.test.ts` *(new)*

**Interfaces:**
- Produces:

```ts
/** `linear-gradient(<angle>deg, <from>, <to>)`. */
export function gradientValue(angle: number, from: string, to: string): string;

/** The structured form of a plain two-stop linear gradient, or null (a gradient
 *  the builder did not write stays raw text in the editor). */
export function inspectGradient(value: string | undefined): { angle: number; from: string; to: string } | null;

/** `#rgb`, `#rrggbb` or `#rrggbbaa` — what `<input type="color">` can show. */
export function isHexColor(value: string | undefined): boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("writes and reads back the builder's gradient", () => {
  expect(gradientValue(180, "#101418", "#2a3550")).toBe("linear-gradient(180deg, #101418, #2a3550)");
  expect(inspectGradient(gradientValue(45, "#000", "#fff"))).toEqual({ angle: 45, from: "#000", to: "#fff" });
});

it("refuses what it cannot represent", () => {
  expect(inspectGradient(undefined)).toBeNull();
  expect(inspectGradient("#101418")).toBeNull();
  expect(inspectGradient("url(some.png)")).toBeNull();
  expect(isHexColor("#101418")).toBe(true);
  expect(isHexColor("#abc")).toBe(true);
  expect(isHexColor("#abcdefff")).toBe(true);
  expect(isHexColor("red")).toBe(false);
  expect(isHexColor("#12")).toBe(false);
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement** — regex-assembled gradient value; `inspectGradient` with
`/^\s*linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*\)\s*$/i`; `isHexColor`
with `/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i`. Keep `backgroundCss` untouched.

- [ ] **Step 4: Run the test and the suite** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/appearance.ts src/lib/config/appearance.test.ts
git commit -m "feat(layout): the gradient builder and its inspector"
```

---

### Task 8: Handoff protocol — `parseLayoutRef`, deep-copied placements, one request pair

**Files:**
- Modify: `src/lib/config/layout-ops.ts`, `src/lib/pages.js`, `src/lib/components/display/Tile.svelte`
  (call site only), `src/routes/layout/+page.svelte` (call site only)
- Test: `src/lib/config/layout-ops.test.ts`

**Interfaces:**
- Consumes: `deepCopy` (Task 1), `LayoutSelection` (existing).
- Produces:

```ts
/** Read a layout handoff: the deepest node whose ids are all present. Anything a
 *  stale tab or an older build left behind returns null. */
export function parseLayoutRef(raw: unknown): LayoutSelection | null;

// pages.js — same storage key `iHome.editLayout`, JSON value
export function requestLayoutConfig(ref: { pageId: string; sectionId?: string; placementId?: string }): void;
export function takeRequestedLayout(): LayoutSelection | null;
```

The old `parsePlacementRef` / `requestPlacementConfig` / `takeRequestedPlacement` names disappear;
update their two call sites (`Tile.svelte:openEditor`, `routes/layout/+page.svelte:onMount`).

- [ ] **Step 1: Write the failing tests** (append to `layout-ops.test.ts`)

```ts
it("parseLayoutRef reads page, section and tile handoffs from the same shape", () => {
  expect(parseLayoutRef(JSON.stringify({ pageId: "p" }))).toEqual({ kind: "page", pageId: "p" });
  expect(parseLayoutRef(JSON.stringify({ pageId: "p", sectionId: "g" }))).toEqual({ kind: "section", pageId: "p", sectionId: "g" });
  expect(parseLayoutRef(JSON.stringify({ pageId: "p", sectionId: "g", placementId: "t" }))).toEqual({ kind: "tile", pageId: "p", sectionId: "g", placementId: "t" });
});

it("parseLayoutRef rejects junk and a placement without its section", () => {
  expect(parseLayoutRef(null)).toBeNull();
  expect(parseLayoutRef("not json")).toBeNull();
  expect(parseLayoutRef(JSON.stringify({ sectionId: "g" }))).toBeNull();
  expect(parseLayoutRef(JSON.stringify({ pageId: "p", placementId: "t" }))).toEqual({ kind: "page", pageId: "p" });
});

it("duplicatePlacement deep-copies the tile so the copy cannot mutate the original", () => {
  const reg = { version: 1, updatedAt: 0, pages: [{ id: "p", title: "P", groups: [{ id: "g", title: "G", tiles: [
    { id: "t1", device: "d", tile: { slots: [{ kind: "value", source: "power", rules: [{ when: "power > 0" }] }] } },
  ] }] }] } as PageRegistry;
  const next = duplicatePlacement(reg, "p", "g", "t1");
  const copy = next.pages[0].groups[0].tiles![1];
  copy.tile!.slots![0].source = "mutated";
  expect(next.pages[0].groups[0].tiles![0].tile!.slots![0].source).toBe("power");
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`parseLayoutRef` (returns the `LayoutSelection` shapes above), `clonePlacement` switches its
one-level copy for `deepCopy(placement)` + `newId()` (M2), `pages.js` gets the new pair with the same
key/JSDoc style, both call sites updated (`Tile.svelte` keeps calling the predicate
`wantsDeviceConfig(event)` — the Ctrl/Cmd check is unchanged).

- [ ] **Step 4: Run the test and the suite** → PASS · `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/layout-ops.ts src/lib/config/layout-ops.test.ts src/lib/pages.js src/lib/components/display/Tile.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): one handoff protocol for page, section and tile targets (A24)"
```

---

### Task 9: Renderer core — the tile's own slots, raw states, dormancy

**Files:**
- Modify: `src/lib/types/device.ts` (`SlotControl`), `src/lib/components/display/Tile.svelte`,
  `src/lib/components/display/SlotRenderer.svelte`, `src/lib/components/display/slots/ValueSlot.svelte`,
  `src/lib/components/display/slots/ControlWidget.svelte` (prop widening only),
  `src/lib/stores/pages.svelte.ts`
- Test: store/component behaviour by live check; the pure pass is already tested (Task 3).

**Interfaces:**
- Consumes: `pickSlotControls`, `slotVisible`, `pickable` (Task 3).
- Produces:

```ts
// types/device.ts — what a slot renderer reads off a control; EnrichedControl satisfies it
export interface SlotControl {
  id?: string;
  stateId?: string;
  label?: string;
  unit?: string;
  liveValue?: unknown;
  writable?: boolean;
}

// pages.svelte.ts (internal, called from setPageRegistry)
function registerSlotStateIds(reg: PageRegistry): void;
```

- [ ] **Step 1: Tile reads the materialised tile**

In `Tile.svelte`: `const slots = $derived(tile?.slots ?? template.slots);` and use `slots` for the
resolution pass, `mainValueKey` (unchanged logic), the icon slot lookup and `badgeSlots`. Replace the
local `resolved` loop and local `pickable` with:

```ts
function rawControl(source: string): SlotControl | undefined {
  const obj = (ioBroker.objects as Map<string, any>)?.get?.(source);
  if (!obj) return undefined;
  const state = (ioBroker.states as Map<string, any>)?.get?.(source);
  return {
    id: source,
    stateId: source,
    label: obj.common?.name ?? source,
    unit: obj.common?.unit,
    liveValue: state?.val,
    writable: false,
  };
}

const resolved = $derived(
  pickSlotControls(slots, shownControls, { raw: rawControl }),
);
```

The render loop keeps the current skip (`slot.kind !== "icon" && !control` → skip) and the
`slotStyle(...).hidden` skip — a dormant non-icon slot simply renders nothing; an icon slot still
renders its fallback (spec rule, no change).

- [ ] **Step 2: Pages store registers raw sources**

In `pages.svelte.ts`: import `registerProgramStateId` from `$lib/stores/devices.svelte`, add
`registerSlotStateIds(reg)` (walk pages → groups → tiles: every `tile.slots[].source`, plus
`tile.active?.source`; register the id **only when `ioBroker.objects.get(id)` exists**, so device
control names are not subscribed as if they were states), and call it first thing in
`setPageRegistry` (the one place load, echo and commit all pass through — subscription is idempotent).

- [ ] **Step 3: Widen the renderer's control props**

`SlotRenderer.svelte` and `ValueSlot.svelte` take `control?: SlotControl`; where `SlotRenderer`
renders `ControlWidget`, prefer widening `ControlWidget`'s prop if it type-checks (it only reads
widget/value fields), otherwise cast at that single call site with a one-line comment ("widget kinds
only arise for real controls"). `IconSlot` keeps its current props (Task 10 swaps its glyph for `Icon`).

- [ ] **Step 4: Gates + live check**

Run: `npm test` · `npm run check` (0/0) · `npm run lint` (0).
Live: `npm run dev`, broker `192.168.178.9`; on the display open a **Thermometer** tile whose device
lacks humidity: the humidity row is gone, the other rows keep their values (before this change the
row fell back to the next control — the A20 change). Then hand-write a raw state slot into the broker
document (e.g. `{"kind":"value","source":"0_userdata.0.<something>"}` on a test tile): it renders the
state's value and updates live when the state changes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/device.ts src/lib/components/display/Tile.svelte src/lib/components/display/SlotRenderer.svelte src/lib/components/display/slots/ValueSlot.svelte src/lib/components/display/slots/ControlWidget.svelte src/lib/stores/pages.svelte.ts
git commit -m "feat(display): tiles render their own slots, raw states and dormancy (A20, A21)"
```

---

### Task 10: Renderer — the active state, the chart background, the `Icon` component

**Files:**
- Create: `src/lib/components/common/Icon.svelte`
- Modify: `src/lib/config/rule-ops.ts` (the badge raw resolver) + `src/lib/config/rule-ops.test.ts`,
  `src/lib/components/display/Tile.svelte`,
  `src/lib/components/display/slots/IconSlot.svelte`,
  `src/lib/components/display/SlotRenderer.svelte` (background flag only)

**Interfaces:**
- Consumes: `evalActive` (Task 4), `slotVisible` (Task 3), `isImageIcon`/`iconUrl` (Task 6).
- Produces:

```svelte
<!-- Icon.svelte: the app's one icon renderer. Symbol name -> glyph, image -> <img> -->
<!-- props: { value?: string; size?: number; dim?: boolean } -->
```

- [ ] **Step 1: `Icon.svelte`** — `{#if value && isImageIcon(value)}<img src={iconUrl(value)} …/>`
`{:else if value}<span class="material-symbols-outlined">{value}</span>{/if}`; `size` drives
`width/height`/`font-size`; `dim` the existing 0.45 opacity. Then `IconSlot.svelte` renders
`<Icon value={glyph} size={34} dim={style.disabled === true} />` inside its existing button/span.

- [ ] **Step 2: The active state in `Tile.svelte`**

```ts
import { evalActive } from "$lib/config/tile-ops";
import { truthy } from "$lib/config/rule-ops";     // replace the local copy

const baseScope = $derived(ruleScope(device.controls ?? [], getVirtualPool()));
const activeCond = $derived(tile?.active);
const activeControl = $derived(
  activeCond?.source
    ? (resolveControl(shownControls, activeCond.source) ?? rawControl(activeCond.source))
    : undefined,
);
const active = $derived(evalActive(activeCond, activeControl?.liveValue));
// The tile's own flag wins the name `active` over a control alias of the same name.
const scope = $derived({ ...baseScope, locals: { ...baseScope.locals, active } });
```

`pickSlotControls(slots, shownControls, { active, raw: rawControl })`; `badgeSlots` filters through
`slotVisible(s, active)`. A raw-state badge (A21 allows the badge kind on a raw state) needs the same
pseudo-control: extend `resolveBadges` with one optional trailing `raw?: (source: string) => BadgeControl | undefined`
resolver and use it in `controlBadge` when `badgeControl` finds no device control (`BadgeControl` =
the `{ liveValue, unit, rules }` slice `controlBadge` reads); cover the extension in
`rule-ops.test.ts` (a raw source yields a badge with the formatted value, an unresolved one yields
none). The `.tile` element gains `class:active`, styled
`border-color: var(--tile-accent, var(--primary-color));` (border only — glow stays rule territory).

- [ ] **Step 3: The chart background**

Slots with `options.background === true` render in a `.tile-bg` layer (first child, absolutely
positioned `inset: 0`, `pointer-events: none`), the rest into `.tile-body` as today. Stretch whatever
`SparklineSlot` renders (`:global` width/height 100%) so the chart fills the tile behind the content.
Keep them in the same `resolved` pass so `pickSlotControls` still owns "who shows".

- [ ] **Step 4: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: hand-write on a test tile `"active": {"source":"<a switch control of that device>","op":"truthy"}`
and watch the border light up when the switch is on; add a rule `{"when":"active","icon":"flash_on"}`
to its icon slot and watch the glyph change; give a value slot `"showWhen":"active"` and watch it
disappear while off; give a sparkline slot `"options":{"background":true}` and see the chart behind
the values. A tile with no active condition is never active (`showWhen:"active"` slots stay hidden).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/common/Icon.svelte src/lib/components/display/Tile.svelte src/lib/components/display/SlotRenderer.svelte src/lib/components/display/slots/IconSlot.svelte
git commit -m "feat(display): the tile's active state, chart background and image icons (A30, A22)"
```

---

### Task 11: Display routing and chrome — Ctrl/Cmd+click, `Icon`, the M3 tab fix

**Files:**
- Modify: `src/lib/components/display/GroupSection.svelte`, `src/lib/components/AppBar.svelte`

**Interfaces:**
- Consumes: `requestLayoutConfig` (Task 8), `wantsDeviceConfig` (existing), `Icon` (Task 10).
- Produces: the display → editor entries for A24 + the A29 tab fix.

- [ ] **Step 1: Section header handoff** (`GroupSection.svelte`)

The `<h2 class="group-title">` gets an `onclick`: when `wantsDeviceConfig(event)` →
`preventDefault`, `stopPropagation`, `requestLayoutConfig({ pageId, sectionId: group.id })`,
`location.hash = "#/layout"`. The icon inside the header swaps to `<Icon value={group.icon} size={18} />`.

- [ ] **Step 2: Page tab handoff + M3** (`AppBar.svelte`)

`currentId` resolves a stale/empty `view.lastPage`: use the route id or last page **only if it names
an existing page**, else the first page — so a tab is always highlighted (A29). Display page tabs:
`onclick` → if `wantsDeviceConfig(event)` → `preventDefault()` (which also suppresses the browser's
open-in-new-tab for the hash link), `requestLayoutConfig({ pageId: p.id })`, `location.hash = "#/layout"`;
else `setLastPage(p.id)`. Page tab glyphs use `<Icon value={p.icon} size={18} />`.

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: Ctrl+click a section header on the display → the editor opens (the tree/pane wiring lands in
Tasks 15-16; at this point the route's `onMount` already selects it). Ctrl+click a page tab → the
editor opens with that page selected. Delete a page in the editor while the display is open on it →
reload the display: the first tab is highlighted instead of none.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/display/GroupSection.svelte src/lib/components/AppBar.svelte
git commit -m "feat(display): sections and page tabs open the editor; a stale tab always resolves (A24, A29)"
```

---

### Task 12: `IconPicker` + the symbol list + first consumers

**Files:**
- Create: `src/lib/assets/material-symbol-names.json`, `src/lib/components/common/IconPicker.svelte`
- Modify: `src/lib/components/layout/LayoutDetails.svelte` (section + page icon fields)

**Interfaces:**
- Consumes: `Icon`, `isImageIcon`, `collectDocumentIcons`.
- Produces:

```svelte
<!-- IconPicker.svelte: overlay in the ConfirmModal/DevicePicker house style -->
<!-- props: { icon?: string; onPick: (icon: string) => void; onClose: () => void }  ("" = clear) -->
```

- [ ] **Step 1: Fetch the symbol names once and commit them**

```bash
curl -s https://fonts.google.com/metadata/icons -o /tmp/ms-icons.json
node -e "const fs=require('fs');const t=fs.readFileSync('/tmp/ms-icons.json','utf8');const j=JSON.parse(t.replace(/^\)\]\}'/,''));fs.writeFileSync('src/lib/assets/material-symbol-names.json',JSON.stringify(j.icons.map(i=>i.name).sort()))"
```

The metadata endpoint prefixes `)]}'` — the strip is part of the command. Verify the file is a JSON
array (a few thousand names), then commit it.

- [ ] **Step 2: `IconPicker.svelte`** — tabs:

1. **Symbols**: search input + a grid of `<Icon value={name} size={22} />` buttons; render the first
   120 matches only (the list is thousands long), search filters `symbolNames`.
2. **Document**: `collectDocumentIcons(getPageRegistry(), getTemplateRegistry())` (import the two
   stores directly — the picker is global, like `DevicePicker` gets its devices by prop), rendered
   with `Icon` (so an image value previews as an image).
3. **Broker**: every `ioBroker.objects` entry whose `common.icon` is a non-empty string — dedupe by
   icon value, show `Icon` + the object id; picking stores the raw `common.icon` value.
4. **URL**: text input + live `Icon` preview + "Use" button (the raw value is stored as typed; a
   broker-relative path is fine).
   A **Clear** button in every tab calls `onPick("")`. Overlay: fixed backdrop, `position: fixed`,
   Esc closes (copy DevicePicker's scaffolding).

- [ ] **Step 3: First consumers** (`LayoutDetails.svelte`)

Section branch: the icon text input stays, plus a "Choose…" button opening the IconPicker
(`onPick` → `setSection({ icon })`), and the existing glyph preview becomes `<Icon value={section.icon} size={20} />`.
Page branch: same picker button + an `Icon` glyph preview (A28).

- [ ] **Step 4: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: the editor → a section → Choose… → search "bolt", pick it (the header shows the glyph);
Broker tab lists the `common.icon` values the broker actually has; URL tab: paste an image URL and
see it as `<img>` on the section header; pick a document icon from another section; Clear empties it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assets/material-symbol-names.json src/lib/components/common/IconPicker.svelte src/lib/components/layout/LayoutDetails.svelte
git commit -m "feat(layout): the icon picker — symbols, document icons, broker icons and URLs (A23)"
```

---

### Task 13: `BackgroundEditor` + page/section backgrounds

**Files:**
- Create: `src/lib/components/common/BackgroundEditor.svelte`
- Modify: `src/lib/components/layout/LayoutDetails.svelte`

**Interfaces:**
- Consumes: `gradientValue`, `inspectGradient`, `isHexColor`, `backgroundCss`.
- Produces:

```svelte
<!-- BackgroundEditor.svelte -->
<!-- props: { background?: Background; onChange: (bg: Background | undefined) => void } -->
```

- [ ] **Step 1: `BackgroundEditor.svelte`**

Kind select (`none` / `solid` / `gradient` / `image`); `solid`: `<input type="color">` (value =
hex when `isHexColor`, else the black default) plus a raw text field; `gradient`: two colour inputs
plus an angle number (0-360, default 180) building through `gradientValue`, **falling back to a raw
text field whenever `inspectGradient` returns null** (a hand-written gradient is shown, never
destroyed); `image`: a URL text field. Always a live preview strip using `backgroundCss`. `none`
calls `onChange(undefined)`.

- [ ] **Step 2: Wire it in `LayoutDetails.svelte`**

Page branch gains a **Background** field (`page.background` via `setPage` — extend `setPage`'s patch
type with `background: Background | undefined`). Section branch drops its hand-rolled select+input
for `<BackgroundEditor background={section.appearance?.background} onChange={(bg) => setSection({ background: bg })} />`.
The section `setSection` already rebuilds `appearance` and drops empty objects — keep that.

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: page → Background → gradient, two colours + angle: the preview and the display update (the
display already renders `page.background` via `backgroundCss`). Section background the same. Clear
(none) removes it from the document. Paste a hand-written `linear-gradient(...)` into a section's
background by hand (broker) → the editor shows it raw and changes only when you edit the raw field.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/common/BackgroundEditor.svelte src/lib/components/layout/LayoutDetails.svelte
git commit -m "feat(layout): colour/gradient/image backgrounds for pages, sections and tiles (A22, A28)"
```

---

### Task 14: `SlotPicker` + the tile-row `+`

**Files:**
- Create: `src/lib/components/layout/SlotPicker.svelte`
- Modify: `src/lib/components/layout/LayoutTree.svelte`, `src/routes/layout/+page.svelte`

**Interfaces:**
- Consumes: `editTile` + `addSlot` (Task 2), `ensureTile` (Task 1), `collectStates`/`applyFilters`/
  `buildStateTree` (state-tree), `getTemplateRegistry`, `DevicePicker` house style.
- Produces:

```svelte
<!-- SlotPicker.svelte -->
<!-- mode "slot": onAdd(slot)   ·   mode "source": onSource(source)   -->
<!-- props: { device: EnrichedDevice; mode?: "slot" | "source"; onAdd: (slot: Slot) => void;
             onSource?: (source: string) => void; onClose: () => void } -->
```

- [ ] **Step 1: `SlotPicker.svelte`** — three source tabs + a kind select:

1. **This device**: the device's non-hidden controls (label, state id, unit). The `source` string
   written into the slot is the control's **feature when set, else its id** (the convention
   `resolveControl` prefers — check `DeviceForm`/`ControlRow` for the exact field they write and
   match it).
2. **Placeholder**: a free-text hint field ("temperature", "Leistung", …) → slot
   `{ kind, options: { pick: text } }` — resolvable at render, dormant when nothing matches (A20).
3. **Any state**: a search field + flat list (id, name, current value) over
   `collectStates(ioBroker.objects)` + `applyFilters`, capped at 200 rows; picking a state gives
   `source: stateId` and a read-only pseudo-control at render (A21).
   In `mode "source"` (the active condition) tabs 1 and 3 choose the source string and call
   `onSource`; there is no kind select.
   Kind select (`slot` mode): `value` (default), `icon`, `badge` (+ the device-control kinds
   `level`, `color`, `enum`, `button`, `sparkline`, `history-list` — offered **only** for tab 1);
   raw states are limited to `value`/`icon`/`badge` (A21). A badge keeps its default options
   (`resolveBadges` reads the picked control live; `badgePosition` picks the corner; the special
   sources `ago` / `offline` stay a pane-level concern, Task 17).

- [ ] **Step 2: Wire the tree `+` and the route**

`LayoutTree.svelte`: every tile row gets an `add` icon-btn (`title="Add slot"`) calling a new prop
`onAddSlot(pageId, sectionId, placementId)`. `routes/layout/+page.svelte`: `pickerFor` becomes a
union (`{ kind: "device"; pageId; sectionId } | { kind: "slot"; anchor: PlacementAnchor }`); on slot
pick:

```ts
const device = devices.find((d) => d.id === placement.device);
if (!device) return;                       // dangling device: refuse, the tree already warns
commitLayout(editTile(registry, anchor, device, getTemplateRegistry().templates, (t) => addSlot(t, slot)));
```

The display's tile body keeps Ctrl/Cmd+click → editor only — it opens no dialogs; Task 17's
"Add slot" button in the pane opens this same picker through the route.

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: editor → a tile row → `+` → "This device": add a value bound to e.g. the pump's power — the
tile preview and the display show it, and the broker document now carries
`tile: { template, size, slots: [...] }` (materialised, A18). Add a placeholder "humidity" on a device
without one: it renders nothing and does not shift the other rows. Add an "any state" value: it
renders read-only and updates when the state changes. In `source` mode (not reachable until Task 16)
the same picker returns a string — check by hand if convenient.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/SlotPicker.svelte src/lib/components/layout/LayoutTree.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): the slot picker — device controls, placeholders and any state (A21)"
```

---

### Task 15: Tree — `Icon` rows and fold-everything-except (handoff focus)

**Files:**
- Modify: `src/lib/components/layout/LayoutTree.svelte`, `src/routes/layout/+page.svelte`

**Interfaces:**
- Consumes: `Icon` (Task 10), `LayoutSelection` (Task 8).
- Produces: the A24 tree behaviour — a new prop `focus?: LayoutSelection | null`; when it changes,
  fold every page/section except the target path.

- [ ] **Step 1: `focus` prop + the effect**

```ts
let { focus = null, /* …existing props… */ } = $props();

// Applied once per handoff: later manual folding must survive registry updates.
let applied: LayoutSelection | null = null;
$effect(() => {
  const f = focus;
  if (!f || f === applied) return;
  applied = f;
  const openSection =
    f.kind === "section" || f.kind === "tile" ? f.sectionId : undefined;
  const next: Record<string, boolean> = {};
  untrack(() => {
    for (const page of registry.pages) {
      next[page.id] = page.id !== f.pageId;
      for (const section of page.groups) {
        next[section.id] = section.id !== openSection;
      }
    }
  });
  folded = next;
});
```

`routes/layout/+page.svelte`: keep a route-local `let focus = $state<LayoutSelection | null>(null)`;
`onMount` sets both `selection` and `focus` from `takeRequestedLayout()`; pass `{focus}` to the tree.
(Clicking in the tree changes only `selection` — no refolding.)

- [ ] **Step 2: `Icon` in the tree rows**

Swap the `material-symbols-outlined` spans in the page/section label rows for `<Icon value={…} size={17} />`,
and give tile rows the device's icon (`deviceOf(tile.device)?.icon`) next to the warning glyph —
the same visual language as the display.

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: Ctrl+click a section header on the display → the editor opens with that section unfolded, all
other pages and sections folded, its tiles listed right below. The same for a tile (Ctrl+click a
tile on the display) and a page tab. Then fold a *different* section manually, edit something —
the tree must not re-fold.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/LayoutTree.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): the tree folds to the handoff target and renders real icons (A24)"
```

---

### Task 16: Tile pane part 1 — general options, templates, device, move, reset

**Files:**
- Modify: `src/lib/components/layout/LayoutDetails.svelte`, `src/routes/layout/+page.svelte`

**Interfaces:**
- Consumes: `editTile` (Task 2), `setTile` → `patchPlacement` (existing), `ensureTile`/`resetTile` (Task 1),
  `templateFromTile`/`upsertTemplate`/`applyTemplate` + `commitTemplates`/`isTemplatesWritable`/
  `getTemplateSaveFailed` (Task 5), `BackgroundEditor` (Task 13), `SlotPicker` source mode (Task 14),
  `DevicePicker`, `ConfirmModal`, `movePlacement` (existing).
- Produces: the tile pane's general-options block; a new prop `onSelect?: (s: LayoutSelection) => void`.

- [ ] **Step 1: General options**

Keep the title field, device line, newLine checkbox, size selects, and the preview; route **every**
tile write through `editTile` (so the first write materialises — `setSize` switches from
`setTile({tile: {...}})` to `editTile(..., (t) => patchSlot? no — a `setField` helper:

```ts
const edit = (fn: (tile: TileConfig) => TileConfig) => {
  if (!page || !section || !tile || !device) return;
  onChange(editTile(registry, { pageId: page.id, sectionId: section.id, placementId: tile.id }, device, getTemplateRegistry().templates, fn));
};
```

Add, in this order:
- **Background**: `<BackgroundEditor background={tile.tile?.background} onChange={(bg) => edit((t) => ({ ...t, ...(bg ? { background: bg } : { background: undefined }) }))} />`
  plus a **History chart** select: `off` + one option per already-used source and per device control;
  choosing = upsert a sparkline slot with `options: { background: true, source }` and `source` set
  (off removes exactly that slot) — that is the "chart behind the content" (A22).
- **Active when**: a source button (opens the SlotPicker in `source` mode) showing the current
  source or "not set"; an operator select (`on`/`truthy`, `>`, `≥`, `<`, `≤`, `=`, `≠`); a value text
  field (hidden for `truthy`); a Clear button. Writing: `edit((t) => ({ ...t, active: { source, op, value } }))`,
  clearing `active: undefined`. Show the live value next to it when resolvable; when the source
  resolves to nothing the pane says "source not found" (the tile is simply never active — spec §8).
- **Size**: as today but through `edit`; the fields show `effectiveTileSpan()` (unchanged).
- **Templates**: a "copied from <name>" line when `tile.tile?.template` (fall back to "device chain"),
  plus when materialised a **Reset** button (ConfirmModal: "The tile returns to its device/template
  chain") → `setTile({ tile: undefined })`.
  `Save as template…`: a name input + Save (disabled while `!isTemplatesWritable()`); if a template of
  the same name **and** `device.type` exists → ConfirmModal "Replace '<name>'?"; commit
  `commitTemplates(upsertTemplate(getTemplateRegistry(), templateFromTile(tile.tile ?? {}, device, getTemplateRegistry().templates, name)))`.
  A `getTemplateSaveFailed()` note renders as the pane's "not saved" badge.
  `Apply template`: a select of `getTemplateRegistry().templates.filter((t) => t.type === device.type)`
  + Apply after a confirm → `setTile({ tile: applyTemplate(tile, chosen).tile })` (size, slots and
  background replaced; the active condition survives; the title is placement-level and stays).
- **Change device** (I8/A25): a button opening the DevicePicker; on pick, if the tile is materialised
  → ConfirmModal ("Its own slots, background and active condition are dropped — they were built for
  <old name>"); then `onChange(patchPlacement(..., { device: id, ...(dropped ? { tile: undefined } : {}) }))`.
- **Move to section** (I9/A26): a select of all sections (`<optgroup label={page.title}>`); choosing
  one appends the placement there:
  `onChange(movePlacement(registry, { pageId, sectionId, index: tileIndex }, { pageId: target.page, sectionId: target.section, index: targetLength }))`
  then `onSelect?.({ kind: "tile", pageId: target.page, sectionId: target.section, placementId: tile.id })`
  so the pane follows the tile.

- [ ] **Step 2: Route wiring**

`routes/layout/+page.svelte` passes `onSelect={(s) => (selection = s)}` to `LayoutDetails` and owns
the device-swap picker state (`swapFor: PlacementAnchor | null`, reusing DevicePicker).

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live (the whole pane on the real document): edit a tile's size → the document gains the materialised
`tile.slots` copy; set a background + a history chart; set Active when on the pump's switch and see
the border change; **Save as template** with a new name → `templateList` appears with version 1; save
again with the same name → confirm → still one entry, same id, new slots; **Apply** that template to
another tile of the same type → size/slots/background replaced, title kept; **Reset** → the tile
returns to the chain; **Change device** → confirm modal only for a materialised tile; **Move to
section** → the tile moves and the pane still shows it. Corrupt `templateList` by hand (invalid JSON)
→ the pane says it is not writable and save is disabled; restore the value.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/LayoutDetails.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): the tile pane's options, templates, device swap and move (A19, A25, A26)"
```

---

### Task 17: Tile pane part 2 — the slots list and the rules editor

**Files:**
- Modify: `src/lib/components/layout/LayoutDetails.svelte` (+ the route prop it already has)

**Interfaces:**
- Consumes: Task 3 (`slotVisible` for the visibility marker), Task 16's `edit`, `IconPicker`,
  `ruleScope`/`evaluateVirtual` (live rule dots), `patchSlot`/`removeSlot`/`moveSlot`/`addRule`/
  `patchRule`/`removeRule`/`moveRule` (Task 2), `SlotPicker` (Task 14).
- Produces: the slots section of the tile pane.

- [ ] **Step 1: The list**

Rows come from `tile.tile?.slots ?? resolvedTemplate.slots` (a materialised view; the first edit of
any row materialises through `edit`). Row = kind glyph (`<Icon>`) + summary (`value · temperature`,
`badge · battery`, `sparkline · history`) + visibility badge ("active only" / "inactive only") +
↑ ↓ + delete; expanded (one at a time) shows: kind select, **source** (button opening the SlotPicker;
for raw states show the read-only marker), label, unit, per-kind knobs (`options.index`, `pick` free
text, badge `options.of`/`options.from` and the source values `ago` / `offline`, level
`min`/`max`/`step`, decimals), **Visibility** select (both / only
active / only inactive → `showWhen: undefined | "active" | "inactive"`), ↑↓, delete.
A slot whose source/hint does not resolve against the device **and** the state objects is marked
"not assigned — bind or remove" with a **Bind** button (SlotPicker again) (A20/A21).
"Add slot" button opens the SlotPicker (route-owned, as in Task 14). When the tile has no active
condition, a `showWhen`-set row carries the note "only when active — no active condition set"
(Review Focus 5).

- [ ] **Step 2: The rules editor**

Per slot, collapsible "Rules": ordered rows, last match wins — `when` (text input + a live result dot
via `evaluateVirtual(rule.when, ruleScope(device.controls ?? [], getVirtualPool()))`: green when
`true`, red on error, grey otherwise), icon (IconPicker button + clear), colour
(`<input type="color">` + clear), glow / hidden / disabled (checkboxes), background (text),
tone (select `info|ok|warn|danger` + clear), ↑ ↓, delete; "Add rule". The section's help text
mentions that `active` is available in `when`.

- [ ] **Step 3: Gates + live check**

Gates: `npm test` · `npm run check` · `npm run lint`.
Live: on the Brunnen (or any switch) tile — add the power badge, set "only active", give the tile
Active when = its switch and watch the badge appear only while it runs; add a rule
`when: "active"` → icon `flash_on` on the icon slot and watch the glyph; reorder two rules and see
the last-match-wins result change; delete the active condition and confirm the pane's
"no active condition set" note; leave the document valid (the display still renders every page).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/layout/LayoutDetails.svelte
git commit -m "feat(layout): slot list and per-slot rules in the tile pane (A20, A30)"
```

---

### Task 18: Whole-slice live verification + gates + handoff

**Files:**
- Create: `docs/progress/handoff-2026-10-16-<letter>-iobroker-visual-adapter.md` *(per AGENTS.md naming)*

- [ ] **Step 1: Walk the spec's success criteria on the real broker** (criteria 1-8 of the spec's §1):

1. `+` from the tile row and the pane: device control, placeholder, any state — display updates live.
2. Per-slot rules editable in order (when/icon/colour/glow/background/hidden/disabled/tone).
3. Save-as-template (first save writes `templateList` **version 1**) and apply on another same-type
   tile; placeholders stay dormant until they resolve.
4. First edit materialises; Reset returns to the chain; a legacy partial `tile` keeps its size.
5. Page/section backgrounds via colour picker + gradient builder; icons via the picker.
6. Slot `+` links only the tile's own device controls or any state; raw states render read-only.
7. Unmaterialised and legacy partial tiles render exactly as before; an unreadable document is never
   overwritten (test `templateList` and `pageList` garbage by hand, restore after).
8. A tile's active condition: `.active` border, `when: "active"` rules, per-slot visibility — the
   Brunnen power badge only while active.

- [ ] **Step 2: Gates** — `npm test` (all) · `npm run check` (0/0) · `npm run lint` (0) · `npm run build`.

- [ ] **Step 3: `graphify update .`** and commit anything the graph needs.

- [ ] **Step 4: Write the handoff** into `docs/progress/` (what landed, the live-check results, what
is deferred: P3 modal slots + `Slot.from`, `/templates` page, icon upload, I11 focus trap, M1) and
commit it.

---

## Deferred (do not build here)

- Modal slots and `Slot.from` (P3); a `/templates` library page, template delete/rename, `basedOn`
  editing, the device-form `template` field; section member/showEmpty/width hints; icon upload;
  drag-and-drop (the ↑↓ buttons stay); packaging/pushing; the I11 focus trap and tree keyboard
  contract (M1); the parked ThinkPad items (Brunnen double-toggle, `main.js` literal logging,
  duplicate tile titles, unused `house-controller.svg`).
