# The layout sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the layout sheet on `feature/layout-sheet` — replace the two things the spike approximated, add the one piece nobody has seen (click-a-tile-in-the-display), and retire what the sheet replaces.

**Architecture:** The editor is a mode of the display route (`LayoutSheet.svelte`, opened by the app bar's pencil). Its navigation is a pure cursor (page → section → tile → device) with one editor at a time in the body. Two pieces of logic that currently live inside components move into pure modules so they can be tested: the cursor's fallbacks, and a tile's resolved parts (which the sheet needs to ask "does this tile have anything in the detail page?").

**Tech Stack:** Svelte 5 (runes), SvelteKit, TypeScript, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-10-18-ihome-layout-sheet-design.md` (A43–A50)

**Already built** (on this branch, verified live — do not rebuild): A43 (the mode of the display: no route, no tab, the pencil/eye, the inset/bottom sheet), A44 (the three layout lines), A45's wiring, A47 (the Detail Page dialog), A50 (the Device line, one editor at a time, add/delete). This plan is the finishing pass.

## Global Constraints

- Work in the worktree `C:\Users\franz\.local\share\opencode\worktree\c399be\spike\layout-sheet`, branch `feature/layout-sheet`. The main checkout stays untouched.
- Gates after every task: `npm test` (328 passing today), `npm run check` (0 errors, 0 warnings), `npm run lint`, `npm run build`.
- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`); no `export let`, no stores-as-objects where runes work.
- Never write to the live ioBroker document while verifying. Browser checks are read-only; a write is the user's call.
- Every decision that changes behaviour gets a spec row (A-series) and a line in `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md`.
- One commit per task, message in the project's style (`feat(editor): …` / `fix(display): …`).

## Review Focus

Inputs the spec implies but no task's own tests exercise — each gets a test in the task named:

1. **A placement whose device was deleted** (the sheet's delete, A50) — nothing throws; the Device line reads "no device"; the display skips the tile. → Task 1's cursor tests + Task 3's browser check.
2. **An empty page or an empty section** — the selectors still render and the body shows nothing instead of throwing. → Task 1's cursor tests.
3. **A tile whose only modal content is a frame slot** — the detail page still opens (non-modal, over the display) and closes. → Task 3's browser check.
4. **A click in the display on empty space** (a gap, a section heading) — selects nothing, throws nothing. → Task 4's mapping tests.
5. **A handoff for a tile on another page** — the display follows the cursor's page, and the app bar's tab with it. → Task 1's cursor tests + Task 4's browser check.

---

### Task 1: The cursor as a pure module

**Files:**
- Create: `src/lib/config/sheet-cursor.ts`
- Test: `src/lib/config/sheet-cursor.test.ts`
- Modify: `src/lib/components/layout/LayoutSheet.svelte` (use it)

**Interfaces:**
- Consumes: `PageRegistry`, `LayoutSelection` (from `$lib/types/display`, `$lib/config/layout-ops`).
- Produces:
  ```ts
  export interface SheetCursor {
    page?: Page; pageId: string;
    section?: Group; sectionId: string;
    tiles: Placement[];
    tile?: Placement; tileId: string; tileIndex: number;
  }
  export function sheetCursor(registry: PageRegistry, selection: LayoutSelection | null): SheetCursor;
  /** What changing a placement's device means (A25/A50). */
  export function swapDecision(placement: Placement | undefined, deviceId: string): "noop" | "confirm" | "apply";
  ```

- [ ] **Step 1: Write the failing tests** — `sheet-cursor.test.ts`, using the `section()`/registry helpers already in `layout-ops.test.ts`:

```ts
it("falls back to the first page when the selection names a page that is gone", …)
  // selection { kind:"page", pageId:"gone" } → pageId is the first page's id
it("does not honour a section from another page", …)
  // selection { kind:"section", pageId:"p", sectionId:"g-of-other-page" } → sectionId is p's first
it("falls back to the section's first tile, and reports -1 when there are none", …)
  // empty section → tileId "", tile undefined, tileIndex -1
it("keeps a tile that is still there", …)
  // selection { kind:"tile", … } → tileId is that placement's id, tileIndex its position
it("decides what changing a tile's device means", …)
  // swapDecision(placement, sameId) → "noop"; (placement with no tile, otherId) → "apply";
  // (placement with its own tile config, otherId) → "confirm"   (A25/A50)
```

- [ ] **Step 2: Run them** — `npx vitest run src/lib/config/sheet-cursor.test.ts` → FAIL (`sheetCursor` not defined).

- [ ] **Step 3: Implement `sheetCursor`** — move the sheet's derived chain verbatim: page = the selection's page else `registry.pages[0]`; section = the page's group named by a non-page selection else the page's first; tile = the selection's placement else the section's first. Same file, same style:

```ts
/** What changing a placement's device means (A25/A50). */
export function swapDecision(
  placement: Placement | undefined,
  deviceId: string,
): "noop" | "confirm" | "apply";
```

  `undefined` placement or an empty/same id → `"noop"`; a placement that carries its own `tile` → `"confirm"`; otherwise → `"apply"`.

- [ ] **Step 4: Run them** — PASS.

- [ ] **Step 5: Use it in `LayoutSheet.svelte`** — delete the local `page`/`section`/`sectionId`/`tiles`/`tileId`/`tileAnchor`/`tileIndex` deriveds and read them off `const cursor = $derived(sheetCursor(registry, selection))`. The `$effect` that resets `selection` on a page change stays, reading `cursor.pageId`.

- [ ] **Step 6: Gates** — `npm test` (328 + 4 new), `npm run check`, `npm run lint`, `npm run build`.

- [ ] **Step 7: Browser check** — the sheet still opens on the handoff tile, switching section follows, the display's page follows the sheet's page.

- [ ] **Step 8: Commit** — `refactor(editor): the sheet's cursor is a pure module (A45)`

---

### Task 2: A tile's resolved parts as one helper

**Files:**
- Create: `src/lib/config/tile-parts.ts`
- Test: `src/lib/config/tile-parts.test.ts`

**Interfaces:**
- Consumes: `pickSlotControls`, `resolveTemplate`, `slotVisible`, `badgePositions` (template-ops), `slotWhere` (tile-ops), `resolveBadges` (rule-ops), `resolveStyle` (style-ops), `EnrichedDevice`/`SlotControl`.
- Produces:
  ```ts
  export interface SlotRow { slot: Slot; control?: SlotControl; style: ResolvedStyle; }
  export interface TileParts {
    body: SlotRow[]; background: SlotRow[]; modal: SlotRow[];
    badgeSlots: Slot[]; modalBadges: ResolvedBadge[];
    /** Anything at all in the detail page: rows or badge chips. */
    hasModal: boolean;
  }
  export function tileParts(
    device: EnrichedDevice,
    tile: TileConfig | undefined,
    templates: Template[],
    opts?: { active?: boolean; raw?: (source: string) => SlotControl | undefined },
  ): TileParts;
  ```
  `hasModal` is `modal.length > 0 || modalBadges.length > 0` when badges are resolvable, and `modal.length > 0 || badgeSlots-in-modal > 0` when `opts.raw` is absent — the sheet's question needs no clock.

- [ ] **Step 1: Write the failing tests** — a device with one control and tiles whose slots are: `{kind:"value", source:"temperature"}` (tile), `{kind:"value", source:"humidity", where:"modal"}`, `{kind:"frame", options:{url:"…"}, where:"both"}`, `{kind:"badge", options:{pick:"offline"}, where:"modal"}`:

```ts
it("splits the chain's slots by where they live", …)
  // body: the tile value; modal: the modal value + the frame; hasModal true
it("a tile-only slot never counts as modal content", …)
  // only { where:"tile" } → hasModal false
it("a rule-hidden modal slot is not modal content", …)
  // rules: [{…, hidden: true}] → hasModal false
it("a frame slot passes through without a control", …)
  // the frame row has control undefined and is in both body and modal
```

- [ ] **Step 2: Run them** → FAIL.

- [ ] **Step 3: Implement `tileParts`** — move `Tile.svelte`'s chain (lines ~119–200 and the two badge blocks at ~266–300) into the module: `slots` = `tile?.slots ?? resolveTemplate(device, templates).slots`; `pickSlotControls(slots, shownControls, {active, raw})` filtered by `(kind icon|frame || control) && !slotStyle(…).hidden`; split by `slotWhere(s) !== "tile"` for modal and `options.background !== true && slotWhere !== "modal"` for body; badges by `slotVisible(s, active) && slotWhere(s) !== "modal"`; modal badges by `slotWhere(s) !== "tile"`.

- [ ] **Step 4: Run them** → PASS.

- [ ] **Step 5: Gates.**

- [ ] **Step 6: Commit** — `refactor(display): one helper resolves a tile's parts (A46/A47)`

---

### Task 3: Both consumers use the helper

**Files:**
- Modify: `src/lib/components/display/Tile.svelte` (its deriveds become `tileParts(...)` calls)
- Modify: `src/lib/components/layout/LayoutSheet.svelte` (drop `hasModalParts`, use `tileParts(...).hasModal`)
- Modify: `src/lib/components/layout/LayoutDetails.svelte` (remove the `showPreview` prop and A33's preview block)

**Interfaces:** consumes Task 2's `tileParts`.

- [ ] **Step 1: `Tile.svelte`** — replace `resolved`/`backgroundSlots`/`bodySlots`/`modalSlots`/`modalRows`/`badgeSlots`/`modalBadges` with one `const parts = $derived(tileParts(device, tile, getTemplateRegistry().templates, { active, raw: rawControl }))`, keeping `modalRows`'s mapping (the background flag dropped, `onPrimary` set) in the component. `hasModal` reads `parts.hasModal`.

- [ ] **Step 2: `LayoutSheet.svelte`** — delete `hasModalParts`; the Detail Page checkbox uses `tileParts(tileDevice, currentTile?.tile, getTemplateRegistry().templates).hasModal`.

- [ ] **Step 3: `LayoutDetails.svelte`** — remove `showPreview` and the `{#if device && showPreview}` preview block (A33 retired: the display behind is the preview); the sheet's three `showPreview={false}` props go with it.

- [ ] **Step 4: Gates** — 328 + the new tests, check 0/0, lint, build.

- [ ] **Step 5: Browser check** — the display renders identically (tiles, badges, the chart layer, a frame tile), the sheet's Detail Page checkbox is enabled on the frame tile and disabled on `Bad.Thermometer`, and the dialog opens non-modally and closes (Review Focus 3).

- [ ] **Step 6: Commit** — `refactor(editor): tile parts and the preview block retire (A33/A47)`

---

### Task 4: Click a tile in the display to select it (A48)

**Files:**
- Create: `src/lib/config/tile-hit.ts`
- Test: `src/lib/config/tile-hit.test.ts`
- Modify: `src/lib/components/display/Tile.svelte` (expose the placement on its root element)
- Modify: `src/routes/+page.svelte` (the selection layer, only while the sheet is open)
- Modify: `src/lib/components/layout/LayoutSheet.svelte` (accept a selection from the display)

**Interfaces:**
- Produces:
  ```ts
  /** The placement a click landed on: the first element in the hit stack that
   *  carries a placement id, with the page and section it belongs to. */
  export function placementAt(stack: Element[], attr?: string): PlacementAnchor | null;
  ```
- Consumes: `PlacementAnchor` (layout-ops).

- [ ] **Step 1: Write the failing tests** — `placementAt` with hand-built element lists (a `document`-less stub is fine: `{ getAttribute(name) }` objects cast to `Element`):

```ts
it("takes the innermost element that carries a placement", …)
it("returns null when nothing in the stack carries one", …)   // a gap, a section heading
it("reads page, section and placement from the element", …)
```

- [ ] **Step 2: Run them** → FAIL.

- [ ] **Step 3: Implement `placementAt`** — walk the stack, return `{ pageId, sectionId, placementId }` from the first element whose `data-placement-id` (plus `data-page-id`, `data-section-id`) is non-empty; `null` otherwise.

- [ ] **Step 4: Run them** → PASS.

- [ ] **Step 5: `Tile.svelte`** — add `data-page-id={anchor?.pageId}`, `data-section-id={anchor?.sectionId}`, `data-placement-id={anchor?.placementId}` to the root `.tile` element.

- [ ] **Step 6: `+page.svelte`** — while `sheet.open`, render a transparent layer over the display that on click calls `placementAt(document.elementsFromPoint(e.clientX, e.clientY))` and, when it returns something, hands it to the sheet (a `picked` prop). The layer eats every other pointer event, so no display gesture can fire (A43's inertness and A48 coexist).

- [ ] **Step 7: `LayoutSheet.svelte`** — a `picked` prop: an effect sets `selection` to it (and `onPage(picked.pageId)`).

- [ ] **Step 8: Gates.**

- [ ] **Step 9: Browser check** — with the sheet open, clicking a tile in the display selects it (the three lines jump, the editor follows); clicking a gap or a section heading changes nothing; the page tab in the app bar follows a picked tile on another page (Review Focus 4 and 5).

- [ ] **Step 10: Commit** — `feat(editor): a click in the display selects the tile (A48)`

---

### Task 5: Retire the tree and the spike's leftovers

**Files:**
- Delete: `src/lib/components/layout/LayoutTree.svelte`
- Modify: `src/lib/pages.js` (drop anything only the tree used), `src/lib/components/layout/LayoutDetails.svelte` (unused imports), `src/lib/components/display/PageView.svelte` (its unused `onMount` import)
- Modify: `docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md` (the supersede notes exist; check they name A43–A50)

- [ ] **Step 1: Delete `LayoutTree.svelte`** and anything that imports it (nothing should).
- [ ] **Step 2: Sweep unused exports/imports** — `npx eslint` and `npm run check` must stay clean; `grep -rn "LayoutTree" src` returns nothing.
- [ ] **Step 3: Gates.**
- [ ] **Step 4: Commit** — `chore(editor): the tree is gone (A29/A40/A42 retired)`

---

### Task 6: The ledger and the handoff

**Files:**
- Modify: `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md`
- Create: `docs/progress/handoff-2026-10-19-iobroker-visual-adapter.md`

- [ ] **Step 1: Ledger** — one entry per task above, with what was verified and how.
- [ ] **Step 2: Handoff** — the branch state, what the sheet is, what the spike approximated and what replaced it, the open items (the device list's flat selector; the tile editor's own fold-outs, A49) and the commands to run it.
- [ ] **Step 3: Commit** — `docs: the layout sheet, finished`
