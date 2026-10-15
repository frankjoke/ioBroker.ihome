# iHome Layout Editor (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the pages → sections → tiles tree be edited in the app itself, with section appearance and
automatic flow, and make the display render exactly what the editor wrote.

**Architecture:** The broker document `pageList` stays the single source of truth and gains two optional
fields on a section (`appearance`, `tiles`) — a section's tiles become an explicit, ordered list of
*placements* instead of being derived from a filter. A pure `migratePageRegistry` expands the seeded
document once (version 0 → 1). A pure `layout-ops` module holds every tree mutation; a new `#/layout`
route renders the tree, a device picker and a details pane with a live preview through the *same*
display components.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, vitest for pure logic, Playwright for the live
browser checks against the real broker (192.168.178.9).

**Spec:** `docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md` (decisions A8–A17)

## Global Constraints

- Identifiers are `ihome` / `iHome`; never reintroduce `visual-interface` (renamed this session).
- No new runtime dependencies. No new dev dependencies.
- Svelte 5 runes only: `$state`/`$derived`/`$effect`, `onclick={}`, `{#each … (key)}`; no `export let`,
  no `svelte/store`, no `on:click`.
- Every new **pure** function gets a vitest test in the house style: `import { it, expect } from "vitest"`,
  a small local factory helper, no fixtures, no component harness.
- Documents are written **only** through `savePages()` (debounced) from `stores/pages.svelte.ts` — a
  component never calls `ioBroker.setState` for `pageList`.
- `Group.member` is a hint only (A8). Nothing in the renderer may use it for membership after Task 3.
- `version` stays `1` after migration. P1 never writes `tile` contents (A14).
- The working tree already holds uncommitted work from this session: the `ihome`/`iHome` rename and
  identity, the green switch glow, and the `[ihome-dbg]` toggle tracing. **Commit those before Task 1**
  — one commit for the glow (`feat(display): the switch tile glows green when on`), one for the rename
  (`chore: rename the app to iHome and fill the identity`), and one for the tracing if it stays
  (otherwise delete it). Leave `docs/progress/handoff-2026-10-15-b-…md` to the session's own commit.
  Every task below commits **only its own files**.
- Keep `cwd` at the repo root for `svelte-check`/`eslint` (a `.svelte-kit/` inside `src/` throws ~300
  phantom lint errors).
- Gates before each commit that touches `src/`: `npm test` (all pass), `npm run check` (0/0),
  `npm run lint` (**exactly the 5 known pre-existing errors** — `Tile.svelte` mutable `Set`, `pages.js`
  `sessionStorage` ×3, unused import in `control-write.test.ts`). `npm run build` before the branch is done.
- Live checks use the real broker: set `localStorage["__VISUAL__:hostPort"] = "\"192.168.178.9:8081\""`
  (JSON string). `npm run dev` (their server, port 5173) or `npm run preview` for the built app.
- The seeded `pageList` in the broker is the user's real data: migration must be additive, the first
  write after migration is the only one that changes it, and an unreadable document is never written.

## Review Focus

The five inputs/conditions the spec implies but no unit test can fully pin — each gets its check in the
owning task:

1. **A placement whose device no longer exists** (device deleted from the registry): the page must skip
   it rather than render an error tile or blank the section — Task 3.
2. **A document that is absent, empty, or garbage**: absent/empty seeds, garbage is never overwritten,
   and migration runs on neither — Task 2 + Task 5.
3. **Duplicate-page / duplicate-section**: every cloned node needs a fresh id, or the copy shares the
   original's `collapseKey` (`pageId::groupId`) and its placements — Task 4.
4. **Reordering to an edge**: a drop on itself, the same index, index 0, and index == length must be
   no-ops or land exactly where they say — Task 4.
5. **Section appearance boundaries**: `border: false` (no border) vs `border` absent (today's border),
   and `background` set vs unset — Task 6 (display) and Task 8 (editor default).

---

## File Structure

| file | responsibility |
|---|---|
| `src/lib/types/display.ts` | `Placement`, `TileConfig`, `SectionAppearance`, `Group.tiles`/`appearance`, `Slot.from` |
| `src/lib/config/pages-ops.ts` | `resolveByMember` (legacy, migration only), `resolvePage` (tiles-based), `migratePageRegistry`, parse relaxation |
| `src/lib/config/layout-ops.ts` *(new)* | every tree mutation: `moveItem`, page/section/placement add-delete-duplicate-move, `appendDevices` |
| `src/lib/config/layout-ops.test.ts` *(new)* | tests for the above |
| `src/lib/config/appearance.ts` *(new)* | the one `backgroundCss` mapping, shared by `PageView` and `GroupSection` |
| `src/lib/config/pages-ops.test.ts` | migration tests; the old member-based `resolvePage` tests move to `resolveByMember` |
| `src/lib/stores/pages.svelte.ts` | `commitLayout(next)`, the migration hook, the session-only `layoutEdit` flag |
| `src/routes/+layout.svelte` | run the migration once the registry **and** devices are loaded (same place as `backfillDeviceEnums`) |
| `src/lib/components/display/PageView.svelte` | the wrapping page container (sections flow) |
| `src/lib/components/display/GroupSection.svelte` | section element: `appearance`, header, tiles from placements |
| `src/lib/components/display/Tile.svelte` | placement title; skip a dangling device; open the placement on Ctrl/Cmd+click |
| `src/routes/layout/+page.svelte` + `src/lib/components/layout/*` *(new)* | the editor: tree, picker, details, preview |
| `src/lib/pages.js` | nav entry for `#/layout`; the placement handoff (`iHome.editLayout`) |
| `src/lib/components/display/DisplayBar.svelte` | the edit-mode toggle |

---

### Task 1: Model — placements, section appearance, multi-device slots

**Files:**
- Modify: `src/lib/types/display.ts`
- Modify: `src/lib/config/pages-ops.ts:180-200` (`isGroup`)
- Test: `src/lib/config/pages-ops.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact names every later task uses):
  ```ts
  export interface SectionAppearance { border?: boolean; background?: Background; }
  export interface TileConfig { template?: string; size?: Size; slots?: Slot[]; modal?: { slots: Slot[] }; }
  export interface Placement { id: string; device: string; title?: string; tile?: TileConfig; }
  // Group gains: appearance?: SectionAppearance; tiles?: Placement[];
  // Group.member becomes optional: member?: Member;
  // Slot gains:    from?: string;
  ```

- [ ] **Step 1: Write the failing test** (append to `pages-ops.test.ts`)

```ts
it("accepts a section with no member and a placement list", () => {
  const reg = parsePageRegistry({
    version: 1, updatedAt: 1,
    pages: [{ id: "p", title: "P", groups: [
      { id: "g", title: "G", appearance: { border: false }, tiles: [{ id: "t1", device: "dev1" }] },
    ] }],
  });
  expect(reg).not.toBeNull();
  expect(reg!.pages[0].groups[0].member).toBeUndefined();
  expect(reg!.pages[0].groups[0].tiles?.[0].device).toBe("dev1");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/config/pages-ops.test.ts -t "no member"`
Expected: FAIL — `reg` is `null` (`isGroup` requires `member`).

- [ ] **Step 3: Add the types and relax the parser**

In `types/display.ts` add the three interfaces above (**one line of doc each**: "a section's contents,
the truth"; "a tile's own config, materialised on first edit"; "one tile on one section") and the
`Group`/`Slot` fields. In `pages-ops.ts`, `isGroup` becomes: an object with a non-empty string `id`
(and, when present, `member` must be an object).

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run src/lib/config/pages-ops.test.ts` → PASS · `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/display.ts src/lib/config/pages-ops.ts src/lib/config/pages-ops.test.ts
git commit -m "feat(layout): placements, section appearance and multi-device slots in the model"
```

---

### Task 2: `migratePageRegistry` (member → placements)

**Files:**
- Modify: `src/lib/config/pages-ops.ts` (rename the current `resolvePage` → `resolveByMember`; add the migration)
- Test: `src/lib/config/pages-ops.test.ts`

**Interfaces:**
- Consumes: `Placement` (Task 1).
- Produces:
  ```ts
  export const PAGE_REGISTRY_VERSION = 1;
  /** Legacy membership: filters + explicit ids, first claim wins. The migration's only caller. */
  export function resolveByMember<T extends FilterableDevice>(page: Page, devices: T[]): ResolvedGroup<T>[];
  export function migratePageRegistry(reg: PageRegistry, devices: FilterableDevice[]):
    { registry: PageRegistry; changed: boolean };
  ```
  `migratePageRegistry`: for each page, for each group **without** `tiles`, write
  `tiles = resolveByMember(page, devices)`'s devices for that group, each as
  `{ id: crypto.randomUUID(), device: d.id }`; keep `member`; bump `updatedAt`; set `version` to
  `PAGE_REGISTRY_VERSION`. `changed` is true when anything was written. A registry already at
  `version >= PAGE_REGISTRY_VERSION` and with every group carrying `tiles` is returned unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("expands a seeded section into placements, in the resolver's order, keeping the member hint", () => {
  const page: Page = { id: "rooms", title: "Rooms", groups: [
    { id: "room:enum.rooms.WZ", title: "WZ", member: { room: "enum.rooms.WZ" } }] };
  const reg = { version: 0, updatedAt: 1, pages: [page] };
  const devices = [dev({ id: "a", room: "enum.rooms.WZ" }), dev({ id: "b", room: "enum.rooms.WZ" })];
  const { registry, changed } = migratePageRegistry(reg, devices);
  expect(changed).toBe(true);
  expect(registry.version).toBe(1);
  const g = registry.pages[0].groups[0];
  expect(g.tiles?.map((t) => t.device)).toEqual(["a", "b"]);
  expect(g.member).toEqual({ room: "enum.rooms.WZ" });
  expect(g.tiles?.[0].id).not.toBe(g.tiles?.[1].id);
});

it("is idempotent and leaves an already-migrated registry alone", () => {
  const once = migratePageRegistry(regWithMember, devices).registry;
  const twice = migratePageRegistry(once, devices);
  expect(twice.changed).toBe(false);
  expect(twice.registry).toEqual(once);
});

it("migrates an empty section to an empty list and never invents placements", () => {
  const reg = { version: 0, updatedAt: 1, pages: [{ id: "p", title: "P", groups: [
    { id: "g", member: { room: "enum.rooms.Nowhere" } }] }] };
  const { registry } = migratePageRegistry(reg, [dev({})]);
  expect(registry.pages[0].groups[0].tiles).toEqual([]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/config/pages-ops.test.ts -t "expands a seeded section"`
Expected: FAIL — `migratePageRegistry is not a function`.

- [ ] **Step 3: Implement** — rename `resolvePage` to `resolveByMember` (same body, same tests renamed:
  the existing `resolvePage` tests that assert member/filter claiming become `resolveByMember` tests,
  they must keep passing unchanged), then add `migratePageRegistry` as described.

- [ ] **Step 4: Run the tests**

Run: `npm test` → all pass (the renamed legacy tests included).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/pages-ops.ts src/lib/config/pages-ops.test.ts
git commit -m "feat(layout): migrate a member-based page list into explicit placements"
```

---

### Task 3: The renderer resolves placements, not members

**Files:**
- Modify: `src/lib/config/pages-ops.ts` (`resolvePage` on `tiles[]`)
- Modify: `src/lib/components/display/PageView.svelte`, `src/lib/components/display/GroupSection.svelte`
- Test: `src/lib/config/pages-ops.test.ts`

**Interfaces:**
- Consumes: `Placement` (Task 1), `migratePageRegistry` (Task 2).
- Produces:
  ```ts
  export interface ResolvedTile<T = FilterableDevice> { placement: Placement; device: T }
  export interface ResolvedGroup<T = FilterableDevice> { group: Group; tiles: ResolvedTile<T>[] }
  export function resolvePage<T extends FilterableDevice>(page: Page, devices: T[]): ResolvedGroup<T>[];
  ```
  `resolvePage` walks `page.groups` in order, and for each walks `group.tiles` in order, keeping a
  placement whose `device` exists in `devices` (**dangling placements are dropped, not rendered**), and
  dropping a device with `visibleControls < 1` unless `group.showEmpty === true`. A group with no
  resolvable tile is dropped unless `showEmpty`. `PageView` and `GroupSection` switch from `devices` to
  `tiles` (count badge = `tiles.length`, iteration key = `placement.id`).

- [ ] **Step 1: Write the failing tests**

```ts
it("resolves a page from its placement lists, in order, skipping dangling devices", () => {
  const page: Page = { id: "p", title: "P", groups: [
    { id: "g", tiles: [{ id: "t1", device: "b" }, { id: "t2", device: "gone" }, { id: "t3", device: "a" }] }] };
  const res = resolvePage(page, [dev({ id: "a" }), dev({ id: "b" })]);
  expect(res[0].tiles.map((t) => t.device.id)).toEqual(["b", "a"]);
});

it("shows the same device in two sections (no claiming)", () => {
  const page: Page = { id: "p", title: "P", groups: [
    { id: "g1", tiles: [{ id: "t1", device: "a" }] }, { id: "g2", tiles: [{ id: "t2", device: "a" }] }] };
  expect(resolvePage(page, [dev({ id: "a" })])).toHaveLength(2);
});

it("keeps an empty placement list invisible unless showEmpty", () => {
  const page: Page = { id: "p", title: "P", groups: [
    { id: "g1", tiles: [] }, { id: "g2", tiles: [], showEmpty: true }] };
  const res = resolvePage(page, [dev({})]);
  expect(res.map((r) => r.group.id)).toEqual(["g2"]);
});
```

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run src/lib/config/pages-ops.test.ts -t "dangling"` → FAIL.

- [ ] **Step 3: Implement** `resolvePage`, then rewire `PageView`/`GroupSection` (their props keep
  `devices` → `tiles`; `GroupSection` iterates `{#each tiles as t (t.placement.id)}` and passes
  `device={t.device}`).

- [ ] **Step 4: Run the tests, then check the display live** — `npm test` → pass; then in the browser
  (dev server + `__VISUAL__:hostPort`): the Rooms page renders the same tiles as before, and the "N
  devices" count under a chip filter still matches.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/pages-ops.ts src/lib/components/display/PageView.svelte src/lib/components/display/GroupSection.svelte src/lib/config/pages-ops.test.ts
git commit -m "feat(layout): the display resolves a section's placements instead of its filter"
```

---

### Task 4: `layout-ops` — every tree mutation, pure

**Files:**
- Create: `src/lib/config/layout-ops.ts`, `src/lib/config/layout-ops.test.ts`

**Interfaces:**
- Consumes: `PageRegistry`, `Page`, `Group`, `Placement` (Task 1).
- Produces (all return a **new** registry with `updatedAt: Date.now()`, input untouched):
  ```ts
  export function moveItem<T>(list: T[], from: number, to: number): T[];
  export function addPage(reg: PageRegistry, title?: string): PageRegistry;
  export function deletePage(reg: PageRegistry, pageId: string): PageRegistry;
  export function duplicatePage(reg: PageRegistry, pageId: string): PageRegistry;
  export function movePage(reg: PageRegistry, from: number, to: number): PageRegistry;
  export function addSection(reg: PageRegistry, pageId: string, title?: string): PageRegistry;
  export function deleteSection(reg: PageRegistry, pageId: string, sectionId: string): PageRegistry;
  export function duplicateSection(reg: PageRegistry, pageId: string, sectionId: string): PageRegistry;
  export function moveSection(reg: PageRegistry, pageId: string, from: number, to: number): PageRegistry;
  export function appendDevices(reg: PageRegistry, pageId: string, sectionId: string, deviceIds: string[]): PageRegistry;
  export function deletePlacement(reg: PageRegistry, pageId: string, sectionId: string, placementId: string): PageRegistry;
  export function duplicatePlacement(reg: PageRegistry, pageId: string, sectionId: string, placementId: string): PageRegistry;
  export function movePlacement(reg: PageRegistry, from: PlacementMove, to: PlacementMove): PageRegistry;
  /** Where to drop a placement: by index (a move), not by id (an address). */
  export interface PlacementMove { pageId: string; sectionId: string; index: number }
  ```
  Rules: `moveItem` clamps/ignores an out-of-range or equal index and returns a **copy** either way;
  every created node gets `crypto.randomUUID()`; `duplicatePage`/`duplicateSection`/`duplicatePlacement`
  give the clone fresh ids at **every** level below it (a duplicated page's sections and placements are
  new objects with new ids, `member`/`appearance`/`tile` copied by value); `appendDevices` appends in the
  given order and **skips ids already present** in that section; a missing page/section id returns the
  registry unchanged (plus the bumped `updatedAt`).

- [ ] **Step 1: Write the failing tests** (one per behaviour, using a local `reg()` factory)

```ts
it("moves an item, and does nothing for an equal or out-of-range index", () => {
  expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  expect(moveItem(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
});

it("duplicates a section with fresh ids at every level below it", () => {
  const reg1 = duplicateSection(regWithTiles(), "p", "g");
  const [orig, copy] = reg1.pages[0].groups;
  expect(copy.id).not.toBe(orig.id);
  expect(copy.tiles?.[0].id).not.toBe(orig.tiles?.[0].id);
  expect(copy.tiles?.[0].device).toBe(orig.tiles?.[0].device);
  expect(orig.tiles?.[0].id).toBe("t1");           // original untouched
});

it("appends devices once, in order, skipping what is already there", () => {
  const next = appendDevices(regWithTiles(), "p", "g", ["x", "t1dev", "y"]);
  expect(next.pages[0].groups[0].tiles?.map((t) => t.device)).toEqual(["t1dev", "x", "y"]);
});

it("moves a placement between sections and to the end of a list", () => {
  const next = movePlacement(regWithTiles(), { pageId: "p", sectionId: "g", index: 0 },
                                            { pageId: "p", sectionId: "g2", index: 0 });
  expect(next.pages[0].groups[0].tiles).toEqual([]);
  expect(next.pages[0].groups[1].tiles?.map((t) => t.device)).toEqual(["t1dev"]);
});

it("returns the registry unchanged for an unknown page or section", () => {
  const reg0 = regWithTiles();
  expect(deleteSection(reg0, "nope", "g").pages).toEqual(reg0.pages);
  expect(deletePage(reg0, "nope").pages).toEqual(reg0.pages);
});
```

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run src/lib/config/layout-ops.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `layout-ops.ts` (one small function per op, all delegating to a private
  `withPages(reg, fn)` that maps pages and bumps `updatedAt`).

- [ ] **Step 4: Run the tests** — `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/layout-ops.ts src/lib/config/layout-ops.test.ts
git commit -m "feat(layout): pure tree operations (add, duplicate, delete, move) for pages, sections and tiles"
```

---

### Task 5: Commit path + the one-time migration of the live document

**Files:**
- Modify: `src/lib/stores/pages.svelte.ts` (add `commitLayout`)
- Modify: `src/routes/+layout.svelte` (run the migration where `backfillDeviceEnums` already runs)
- Test: live (this task wires existing pure code to the app)

**Interfaces:**
- Consumes: `migratePageRegistry` (Task 2), `resolvePage`/`toFilterable` (Task 3).
- Produces:
  ```ts
  /** The editor's only write path: replace the registry, persist it (debounced). */
  export function commitLayout(next: PageRegistry): void;
  /** True while the last write failed, so the editor can say "not saved" (getter, like getPageRegistry). */
  export function getLayoutSaveFailed(): boolean;
  /** Session-only display edit mode (never persisted). */
  export const layoutEdit: { on: boolean };
  ```

- [ ] **Step 1: Implement `commitLayout`** — `setPageRegistry(next); savePages();`; an internal
  `let saveFailed = $state(false)` behind `getLayoutSaveFailed()`, set `false` on a successful write and
  `true` in `savePages`' catch; `layoutEdit` as an exported `$state` object (the module's existing
  `view` is the pattern).

- [ ] **Step 2: Hook the migration** in `+layout.svelte`'s connect effect, after `initPages(...)` has
  resolved and the device store is populated:

```ts
const { registry, changed } = migratePageRegistry(
  getPageRegistry(),
  $devicesEnrichedStore.map((d) => toFilterable(d)),
);
if (changed) commitLayout(registry);
```

- [ ] **Step 3: Verify live** — open the display; the Rooms/Home pages render as before; then read the
  document with the ioBroker MCP (`get_states` on `0_userdata.0.Test.AiHome.pageList`): `version` is 1,
  every group has `tiles`, `member` survived, and no `visual-interface`/legacy shape is left. Reload
  once more: nothing changes (idempotent).

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/pages.svelte.ts src/routes/+layout.svelte
git commit -m "feat(layout): commit layout edits through one write path and migrate the live document once"
```

---

### Task 6: The display — sections flow, appearance, placement titles

**Files:**
- Modify: `src/lib/components/display/PageView.svelte` (page container becomes a wrapping flow)
- Modify: `src/lib/components/display/GroupSection.svelte` (`appearance`, section element)
- Modify: `src/lib/components/display/Tile.svelte` (placement `title`, dangling guard)
- Test: live at 375 / 820 / 1400 px

**Interfaces:**
- Consumes: `ResolvedTile` (Task 3), `SectionAppearance` (Task 1).
- Produces: no new exported symbols. `GroupSection` gains a `tiles` prop (from Task 3) and applies
  `data-section` with inline `--section-*` custom properties for appearance; `Tile` gains
  `title?: string` (the placement's title wins over `tileTitle(device)`) and `tile?: TileConfig`, whose
  `size` wins over the template's: `span = clampSpan(tile?.size ?? template.size, bp)`.

- [ ] **Step 1: The page container** — `.page` becomes `display: flex; flex-wrap: wrap; align-items: flex-start;`
  with the existing gap, and each section `flex: 0 1 auto; min-width: min(100%, var(--tile-w));` so
  sections pack as many per row as fit and never overflow. The base breakpoint keeps one per row by
  making the minimum the full width there (media query at `size-ops`' 600 px).

- [ ] **Step 2: Section appearance** — `GroupSection` renders `class:no-border={group.appearance?.border === false}`
  and, when `appearance.background` is set, the same `backgroundCss` mapping `PageView` uses (move that
  helper into `src/lib/config/appearance.ts` and import it in both — one implementation, used twice).

- [ ] **Step 3: Placement title and placement size in `Tile`** — the title becomes
  `{$props().title ?? tileTitle(device)}`, and the span becomes
  `clampSpan(tile?.size ?? template.size, bp)`. `GroupSection` passes both down from the placement
  (`title={t.placement.title} tile={t.placement.tile}`).

- [ ] **Step 4: Verify live** — in the browser: (a) 375 px → one section per row, no horizontal overflow;
  (b) 1400 px → narrow sections share a row; (c) temporarily set `appearance.border: false` and a solid
  background on one section via the MCP, reload, confirm the styling, then restore; (d) spot-check the
  untouched behaviour — badges still sit in their corners, the tile modal still opens, a group still
  collapses and stays collapsed after reload, and the filter chips still narrow the tiles. Record the
  measured widths in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/display/PageView.svelte src/lib/components/display/GroupSection.svelte src/lib/components/display/Tile.svelte src/lib/config/appearance.ts
git commit -m "feat(layout): sections flow by available width and carry their own appearance"
```

---

### Task 7: `#/layout` — the route, the tree, page/section/tile CRUD

**Files:**
- Create: `src/routes/layout/+page.svelte`, `src/lib/components/layout/LayoutTree.svelte`
- Modify: `src/lib/pages.js` (nav entry `{ id: "/layout", label: "Layout", icon: "dashboard_customize" }`)

**Interfaces:**
- Consumes: `layout-ops` (Task 4), `commitLayout`/`getPageRegistry` (Task 5), `devicesEnrichedStore`.
- Produces: the two shapes the details pane, the picker and the display handoff share:
  ```ts
  /** One tile's address inside the tree — used by the details pane and the handoff. */
  export interface PlacementAnchor { pageId: string; sectionId: string; placementId: string }
  export type LayoutSelection =
    | { kind: "page"; pageId: string }
    | { kind: "section"; pageId: string; sectionId: string }
    | ({ kind: "tile" } & PlacementAnchor);
  ```

- [ ] **Step 1: Build the route** — the page renders the tree (left) and an empty details pane (right);
  a small toolbar at the top holds "Add page". Every mutation is `commitLayout(addSection(getPageRegistry(), …))`
  and so on — never a local copy, so the display and the editor always agree.

- [ ] **Step 2: The tree** — pages → sections → tiles, each row: expand chevron, icon, title, count,
  and a node menu (add child, duplicate, delete, move up/down). Selection is local `$state` in the route
  and is passed down. A section with an unresolvable `member` hint and no `tiles` shows a muted
  "empty" badge; a placement whose device is unknown shows a warning icon.

- [ ] **Step 3: Wire add/duplicate/delete/reorder** through `layout-ops`, with a confirm step for page
  and section deletion.

- [ ] **Step 4: Verify live** — add a page, rename it, add two sections, add a tile by picking a device
  (a temporary minimal picker is fine here; Task 9 replaces it), reorder, duplicate a section, delete one;
  reload and confirm every step survived, and that the *display* shows the same structure.

- [ ] **Step 5: Commit**

```bash
git add src/routes/layout/+page.svelte src/lib/components/layout/LayoutTree.svelte src/lib/pages.js
git commit -m "feat(layout): #/layout route with the page/section/tile tree"
```

---

### Task 8: The details pane and the live preview

**Files:**
- Create: `src/lib/components/layout/LayoutDetails.svelte`
- Modify: `src/routes/layout/+page.svelte`

**Interfaces:**
- Consumes: `LayoutSelection`/`PlacementAnchor` (Task 7), `GroupSection`/`Tile` (Task 6), `devicesEnrichedStore`.
- Produces: nothing new — the pane edits the registry through `layout-ops` + `commitLayout`.

- [ ] **Step 1: Section fields** — title (text), icon (a **text field with a live glyph preview**; no
  icon picker in P1), `appearance.border` (checkbox, **default checked** = today's border), and
  `appearance.background` (kind + value, reusing the page background control's markup if one exists —
  read `DeviceForm`/`settings` for the pattern). Empty fields remove the property rather than storing `""`.

- [ ] **Step 2: Tile fields** — device (read-only label + "change device" via the picker), `title`, and
  `size` (w/h 1–4 selectors). Changing `size` writes `placement.tile = { ...placement.tile, size }`
  (materialising an empty tile config is fine; `template`/`slots` stay untouched — A14).

- [ ] **Step 3: The preview** — below the fields, render the selection through the real components:
  a section preview via `GroupSection` with its resolved tiles, a tile preview via `Tile` with
  `device = devicesEnrichedStore.find(d => d.id === placement.device)` and `bp` from the current
  `breakpointFor(window.innerWidth)`. Show "device not found" instead when it dangles.

- [ ] **Step 4: Verify live** — select a section, set a title, a border off, a solid background: the
  preview and the display both update within the debounce (~250 ms); reload and the values persist;
  select a tile, set `w: 2`, see it grow in the preview and on the display.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/LayoutDetails.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): section and tile details with a live preview"
```

---

### Task 9: The device picker

**Files:**
- Create: `src/lib/components/layout/DevicePicker.svelte`
- Modify: `src/routes/layout/+page.svelte`

**Interfaces:**
- Consumes: `devicesEnrichedStore`, `appendDevices` (Task 4), the section's `member` hint.
- Produces: a dialog with `onAdd(deviceIds: string[])`.

- [ ] **Step 1: Read `src/lib/components/discovery/StatePicker.svelte` first** and copy its filter bar
  (search + room/type/function multi-select) and its list markup — the difference is the data: devices
  (name, room, type, live value summary) instead of states, from `devicesEnrichedStore`.

- [ ] **Step 2: Multi-select + add** — checkboxes, a "Add N devices" primary button, closes on add.
  `appendDevices` skips duplicates.

- [ ] **Step 3: "Add all matching" and the not-here affordance** — when the section still has `member`,
  a secondary button "Add all matching" adds every device the hint matches; and the section row in the
  tree shows "N devices in <hint> are not in this section" with the same action. (Read the hint's room/
  function label from the existing enum helpers in `$lib/config/rooms`.)

- [ ] **Step 4: Verify live** — add three devices to a section, add one duplicate (count grows by the
  new ones only), use "add all matching" on the migrated Rooms page's "Bad" section and confirm the
  count matches the hint, then remove them again.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/DevicePicker.svelte src/routes/layout/+page.svelte
git commit -m "feat(layout): device picker with filters and add-all-matching"
```

---

### Task 10: Reachability — Ctrl/Cmd+click and edit mode

**Files:**
- Modify: `src/lib/pages.js` (a placement handoff next to the device one)
- Modify: `src/lib/components/display/Tile.svelte` (Ctrl/Cmd+click → the placement)
- Modify: `src/lib/components/display/DisplayBar.svelte` (edit-mode toggle), `src/lib/stores/pages.svelte.ts` (`layoutEdit`)
- Modify: `src/routes/layout/+page.svelte` (honour an incoming placement request)

**Interfaces:**
- Consumes: `PlacementAnchor` (Task 7), `layoutEdit` (Task 5).
- Produces:
  ```ts
  export function requestPlacementConfig(ref: { pageId: string; sectionId: string; placementId: string }): void;
  export function takeRequestedPlacement(): { pageId: string; sectionId: string; placementId: string } | null;
  ```
  (sessionStorage key `iHome.editLayout`, JSON; a malformed value returns `null`. `requestDeviceConfig`/
  `takeRequestedDeviceConfig` stay for the tree's "edit device" link.)

- [ ] **Step 1: Write the failing test** for the request round-trip — put the pure part
  (`parsePlacementRef(raw: string | null)`) in `layout-ops.ts` so it is testable without a browser:
  valid JSON → the ref; `null`, `""`, `"{oops"`, `{"pageId":1}` → `null`.

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/lib/config/layout-ops.test.ts -t "placement ref"` → FAIL.

- [ ] **Step 3: Implement** the round-trip in `pages.js` on top of `parsePlacementRef`, the tile's
  Ctrl/Cmd+click (`wantsDeviceConfig(event)` → `requestPlacementConfig(...)`; plain click keeps its
  current behaviour), the DisplayBar toggle (a pencil icon button that flips `layoutEdit.on` and shows
  a badge per tile when on), and the incoming-request handling in the layout route (select the
  placement, clear the key).

- [ ] **Step 4: Verify live** — on the display: Ctrl/Cmd+click a tile → `#/layout` with that placement
  selected; turn edit mode on → a tap on a tile opens its editor instead of toggling the control (check
  with a light, do not toggle the Brunnen), turn it off → taps toggle again. On a narrow window the
  toggle is reachable without a modifier.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pages.js src/lib/config/layout-ops.ts src/lib/config/layout-ops.test.ts src/lib/components/display/Tile.svelte src/lib/components/display/DisplayBar.svelte src/lib/stores/pages.svelte.ts src/routes/layout/+page.svelte
git commit -m "feat(layout): open a tile's placement from the display, plus a touch edit mode"
```

---

## After all tasks

- [ ] `npm test`, `npm run check`, `npm run lint`, `npm run build` — all clean (the 5 known lint errors
      are the only ones).
- [ ] One live pass over the whole feature against the real broker: migrate, edit a page, a section's
      appearance, a tile's size and title, reload, and confirm the display matches — at 375/820/1400 px.
- [ ] Read the committed `pageList` back through the MCP: `version: 1`, no `member`-only groups left,
      nothing removed that the user had configured.
- [ ] Whole-branch review by a fresh reviewer, then the branch decision (merge/keep) — the open
      `feature/ihome-display` branch and the handoff's remaining items are unaffected.
