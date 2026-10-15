# Design — iHome layout editor (P1: pages, sections, tile lists)

**Date:** 2026-10-15
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Status:** approved design, spec for implementation planning
**Depends on:** `2026-10-14-ihome-display-design.md` (display basics — same decision numbering, A1–A7)
**Scope:** the *first* slice of real configuration — edit the page → section → tile **tree** in the
UI, with section visuals and automatic flow, and let the display render what the editor wrote.
Tile internals (slots, size, glow, live preview) are P2; the modal surface and multi-device slots
are P3. Deferred work is listed in "Non-goals".

## 1. Intent

Today the display is configured by editing `0_userdata.0.Test.AiHome.pageList` in the ioBroker
admin UI or by changing code. Three concrete problems:

1. The seeded registry (`2026-10-14 22:26`) is a *first guess*: one section per `enum.rooms.*`
   entry, including rooms with no devices, and no way to rename, reorder or remove one.
2. Sections have no appearance: a page can carry a background, a section cannot carry a border,
   a background, or a title style — the thing that makes a wall panel readable.
3. Every tile iteration so far ("show the watts", "make this one green", "give this tile a title")
   required a code change, because there is no editor.

Success criteria:

1. From the running app, a user can create/rename/reorder/delete pages, sections and tile entries,
   and choose section appearance (title, icon, border, background) — with the sections wrapping by
   available width, without anyone declaring a column count.
2. The display renders exactly what the editor wrote: section order, section appearance, tile order,
   and the tile's title/device — verified against the live broker, not a mock.
3. An existing (seeded) document keeps working: migration is pure, idempotent and testable, and an
   unreadable document is left untouched rather than replaced.
4. The editor is reachable from the display on a tablet (no keyboard modifier required).

## 2. Decisions

| # | Decision |
|---|---|
| A8 | A section's contents are an **explicit `tiles[]` list**; `member` survives only as a **filter hint** (seeded pages keep it, and it powers "add all matching" / "N devices in this room are not here"). |
| A9 | A tile is a **placement**: its config lives in the tree. On first edit it is **materialised** from device config → its template → the preset, then it diverges independently (no live inheritance afterwards). |
| A10 | A tile configures **two surfaces** with one slot vocabulary: `slots` (the tile) and `modal.slots` (the enlargement). |
| A11 | A slot may name **another device** (`from`) — a tile is not limited to its placement's device. |
| A12 | Controls stay **standard state widgets** (switch, slider, number/text edit, select via `common.states`); structured/"special" widgets are deferred (P4). |
| A13 | Sections carry **appearance** (border, background); how they sit next to each other **flows automatically** from the available width — no explicit spans, column counts or pinned placement in P1. |
| A14 | P1 edits the tree, section visuals and tile lists only; `tile.slots`/`modal` are P2/P3 and stay at their template/device defaults. |
| A15 | Document changes are **non-destructive and idempotent** (`version` 0 → 1), written with the existing registry pattern; conflicts are last-write-wins. |
| A16 | Editing is **reachable from the display**: Ctrl/Cmd+click opens a tile's **placement** in `#/layout` (the device-config destination was the stopgap while no tile editor existed), plus an explicit edit mode for touch. |
| A17 | The whole document shape (`tile` with `size`/`slots`/`modal`, `appearance`) is fixed by this spec, so P2/P3 add UI without another migration. |

## 3. Architecture

### 3.1 Data flow

```
pageList (broker doc)  ──load/migrate──▶  page registry store (in-memory, reactive)
        ▲                                          │
        │ debounced write                          ▼
    #/layout editor  ──edits──▶  draft copy  ──▶  display (#/, #/p/<id>)
```

One writer path, as today: the store holds the registry, the editor mutates the store, the store
debounces the document write, and the display reads the same store.

### 3.2 Documents

| document | id | role in P1 |
|---|---|---|
| page registry | `0_userdata.0.Test.AiHome.pageList` | read, migrated 0 → 1, and written by the editor |
| device registry | `deviceList` (existing) | read-only: the editor picks devices from it; the list/picker shows their names, rooms and types |
| template list | `0_userdata.0.Test.AiHome.templateList` | **untouched in P1** (currently `null`; P2 seeds it) |

## 4. Data model

Types in `src/lib/types/display.ts` (extended, all new fields optional so old docs stay valid):

```ts
interface Page {
  id: string; title: string; icon?: string;
  background?: Background;          // exists today
  groups: Group[];
}

interface Group {
  id: string;
  title?: string;                   // absent → header-less section (exists)
  icon?: string;
  member?: Member;                  // hint only (A8) — no longer the source of truth
  appearance?: {
    border?: boolean;               // default: the tile border colour rule, as today
    background?: Background;        // reuse of the page type
  };
  showEmpty?: boolean;              // exists
  tiles?: Placement[];              // the truth (A8); absent/empty → nothing rendered
}

interface Placement {
  id: string;                       // stable, editor-generated
  device: string;                   // device id from the device registry
  title?: string;                   // overrides Device.title
  tile?: TileConfig;                // A9: absent → resolve from device → template → preset
}

interface TileConfig {
  template?: string;                // default fill; materialised on first edit (A9)
  size?: Size;                      // exists (1–4, clamped per breakpoint)
  slots?: Slot[];                   // the tile surface
  modal?: { slots: Slot[] };        // the enlargement (A10)
}
```

`Slot` gains one optional field: `from?: string` (device id; A11). Without it a slot resolves within
the placement's device, exactly as today.

### 4.1 Model rules

1. **Order** is array order at every level: `pages[]`, `groups[]`, `tiles[]`. No `order` field.
2. **A tile id is unique inside its section**, a section id inside its page, a page id in the
   registry. Ids are generated once and never reused.
3. **A placement with no `tile`** renders from `device.template/size/slots` → template → preset
   (the existing chain). P1 never writes a partial `tile`: when the editor writes one it writes a
   **complete, materialised** config (A9).
4. **Deleting a device from the registry** leaves its placements dangling: the renderer skips an
   unknown device and logs a debug line; the editor marks such an entry and offers "remove".
5. **An empty section** renders nothing unless `showEmpty` is set (rule 7 of the display spec).
6. **`member` is never written by P1** except by the migration (which preserves the existing value)
   and by "add all matching" (which does not modify it). It may be removed by hand without loss.
7. **Grouping stops at the section.** A page's sections are a flat list and a section holds only
   tiles — a topic ("Alarm", "Car") *is* a section, never a container of sections.

## 5. Layout

### 5.1 How sections flow (display)

A page is one wrapping container of sections; a section is an item whose natural width is its
content's (the tile module grid already gives every tile a minimum width), bounded below by one tile
and above by the available width. So a page packs as many sections side by side as fit and wraps the
rest — on a phone a section ends up full width, on a tablet two narrow sections share a row, on a
desktop several do — and nobody declares a column count (A13).

Visual coherence inside that flow is a styling rule, not data: one gap, one alignment, so the
sections of a page read as parts of the same page rather than as floating islands. `appearance` stays
per section, so a topic ("Alarm", "Electricity", "Car") can carry its own background or border
without leaving the flow.

A per-section width hint — so the editor could make one section deliberately wider — is
**deliberately not in P1**: it is the first thing to add if the automatic result ever looks wrong,
and the document stays valid when it arrives.

### 5.2 The editor page (`#/layout`)

Three areas on one screen, no tabs (the tree carries the nesting):

| area | contents |
|---|---|
| tree (left) | pages → sections → tiles, collapsible; selection drives the details pane; drag handles for reorder/move; per-node add/duplicate/delete |
| picker | opens over the tree: a device multi-select with search + room/type/function filters, following the pattern of `components/discovery/StatePicker.svelte`, plus "add all matching" (from the section's `member` hint) and a "N devices in this room are not here → add" affordance |
| details (right) | for a section: title, icon, border, background; for a tile: device, `title`, `size`; below both: a **live preview** of the selection rendered by the real components against the live broker values |

The right-hand details pane edits a *draft* that is the store: edits apply to the in-memory registry
immediately (so the preview and the display update live) and are persisted debounced (A15).

## 6. Renderer

Changes the display needs in P1 (so the editor is verifiable):

1. `resolvePage` (or its successor) resolves a section's devices from `tiles[]` in array order;
   `member` is no longer consulted for membership. A section with no `tiles` renders nothing
   (unless `showEmpty`, which then shows an empty-state hint).
2. A group renders its section header (`title`/`icon`) as today, wrapped in the section element that
   carries `appearance` (border/background), inside the page's wrapping container.
3. A placement's `title` overrides `Device.title` in the tile, which already falls back to the
   derived name; nothing else about the tile changes in P1.
4. A dangling placement (unknown device) is skipped, not rendered as an error.
5. Existing behaviour that must not regress: module grid with `minmax(row, auto)`, badge corners,
   top alignment, half-module width, Ctrl/Cmd+click, the modal, chips/collapse state in
   `__VISUAL__` localStorage, and the Home route being the display.

## 7. Interaction

| action | behaviour |
|---|---|
| select | click a node; the details pane and preview follow. Keyboard: `↑`/`↓` move, `Enter` expands/selects |
| add page / section / tile | buttons on the node or the toolbar; the new node gets `crypto.randomUUID()` as its id (the app's existing pattern) and a default title — page "Page N", section "New section", tile the device's name |
| duplicate | copies the node (page/section: deep copy with fresh ids; tile: same device, same `tile`) |
| delete | with a confirm step for a page or a section (a tile deletes immediately) |
| reorder / move | drag inside/across sections; a drop indicator shows the insertion point; on drop the arrays are rewritten in the new order. Touch: the tree also offers "move up/down" in the node menu, so a tablet needs no drag |
| rename | inline in the tree or in the details pane |

Drafts are never destroyed by navigation: the store is the draft (single source of truth), and the
editor always shows what the store holds.

## 8. Editing (reachability from the display)

1. The existing Ctrl/Cmd+click handoff (`sessionStorage` key `iHome.edit`, currently "open this
   device in `#/devices`") is **retargeted**: on a tile it opens `#/layout` with that placement
   selected, because a tile's own config now lives in the tree (A9). "Edit device" is one click away
   in the details pane, and the `#/devices` gesture stays reachable from the tree and the device list.
2. **Edit mode** on the display bar (an explicit toggle, remembered in `__VISUAL__` for the session
   only): while on, a tap on a tile opens that placement in `#/layout` instead of toggling its
   control, and each tile shows a pencil cue. While off, nothing about the display changes.
3. The display never writes the document; the editor is the only writer.

## 9. Migration & seeding

```
migratePageRegistry(registry, devices) -> { registry, changed }
```

- Input: the loaded document (parsed and validated by `doc-parse`) and the device list.
- For every group without `tiles`: expand the current membership — the devices the **existing
  resolver** would show today, in that order (explicit `ids` claim a group first, then the filter
  matches in registry order) — into `Placement[]` with fresh ids, leave `member` in place, set
  `registry.version = 1`, bump `updatedAt`.
- Idempotent: a group that already has `tiles` is untouched; running it twice changes nothing.
- Non-destructive: an unreadable or unparsable document is **not** migrated and **not** written (the
  store's existing rule), and a document at `version >= 1` is passed through untouched.
- Empty groups: migrated to `tiles: []` — the editor shows them, the display hides them unless
  `showEmpty`.
- The migration runs once, on load, in the same place the registry is loaded today; the first
  document write that follows carries the migrated shape.

## 10. Error handling

| case | behaviour |
|---|---|
| document unreadable / unparsable | keep the in-memory registry, write nothing (existing rule), show a warning line in the editor |
| write fails | the debounced write retries once on the next change; the editor keeps the draft and shows a "not saved" indicator |
| two tabs edit at once | last write wins (documented; the display does not write, so the exposure is two editor tabs) |
| a drop target is invalid (e.g. a section onto a tile) | the drop is refused with the indicator, no array change |
| a placement's device is not in the registry | entry is marked in the tree, skipped by the renderer |

## 11. New/changed files

| file | change |
|---|---|
| `src/lib/types/display.ts` | `Placement`, `TileConfig`, `Slot.from`, `Group.appearance`, `Group.tiles` |
| `src/lib/config/pages-ops.ts` | tree ops (add/remove/move/duplicate at three levels), `migratePageRegistry`; `resolvePage` reads `tiles[]` |
| `src/lib/config/pages-ops.test.ts` | tests for every op + migration (idempotence, unreadable doc, unknown device) |
| `src/lib/stores/pages.svelte.ts` | expose the editable registry + the debounced write (already partly there) |
| `src/routes/layout/+page.svelte` + components | the editor (tree, picker, details, preview) |
| `src/lib/components/display/GroupSection.svelte` | the section element carrying `appearance`, and the page container that lets sections wrap |
| `src/lib/components/display/Tile.svelte`, `SlotRenderer.svelte` | placement title; skip a dangling device |
| `src/lib/components/layout/` (new) | the tree, picker and details components; the device picker follows `components/discovery/StatePicker.svelte` |
| `src/lib/pages.js` | add the new config route to the nav |
| `src/routes/+page.svelte`, `Tile.svelte` | the Ctrl/Cmd+click handoff opening a placement in `#/layout` + edit mode |
| `docs/superpowers/specs/` | this spec |

## 12. Testing & verification

- **Pure, vitest** (the repo's style: `assert`-free `expect`, no component harness): every tree op
  (including "move to the same position", "delete the last page", "duplicate keeps a stable tile
  id space"), the migration (idempotent, preserves `member`, expands in resolver order, leaves an
  unreadable doc alone), and `resolvePage` reading `tiles[]`.
- **Live browser pass** against the real broker (Playwright, as this session did): load, migrate the
  seeded doc, rename and reorder a section, add a tile, set a border, reload — the display must show
  the new order and appearance, the sections must wrap sanely at 375/820/1400 px with no horizontal
  overflow, and `pageList` must be a valid `version: 1` document.
- **Gates before "done":** `npm test`, `npm run check` (0/0), `npm run lint` (the 5 pre-existing
  errors are known; no new ones), `npm run build`.

## 13. Phases

P1 (this spec):

1. Types + pure ops + migration, with tests (no UI). Verifiable in isolation.
2. `resolvePage`/renderer switch to `tiles[]`, section `appearance`, and the wrapping page container;
   the seeded doc migrated; verified in the browser against the live broker.
3. The `#/layout` page: the tree, the picker, and the details pane (section fields; for a tile:
   device, title, size) with the live preview.
4. Reachability: Ctrl/Cmd+click opens that placement, edit mode on the display bar, nav entry.

Later slices, for context only: **P2** the tile editor (size, slots, glow/rules, live tile preview,
seeding `templateList`) · **P3** the modal surface and multi-device slots (`from`) · **P4** special
widgets if a case needs them (the pump schedule).

## 14. Risks

| risk | mitigation |
|---|---|
| Migration touches the user's live pages | pure function, tests against the *current* document shape, `member` preserved, no write on a bad read, and the change is visible in the editor before the first save |
| Explicit lists mean a new device no longer appears by itself | `member` stays as a hint; the section shows "N devices in this room are not here → add"; "add all matching" is one click |
| Materialised tiles stop following their template/device (intended, A9) | the editor marks "copied from …" and offers "reset to template/device" (P2); the renderer never merges partially |
| The preview and the display drift apart | both render through the same components from the same store |
| Automatic flow puts sections side by side that you would rather see stacked (or the reverse) | fix the styling first — the flow is one gap and one alignment, not per-section geometry; if that is not enough, add the per-section width hint this spec deliberately leaves out |
| Two editor tabs | documented last-write-wins; a `version` check is a later, small addition |

## 15. Non-goals

- Per-section width hints, pinned spans or explicit column counts (A13) — the flow is automatic in P1; a width hint is the first follow-up if the automatic result looks wrong.
- Editing a tile's slots, size, glow or rules (P2), the modal's contents and `from` (P3).
- Any structured/special control (schedule tables, multi-select schemas) — P4.
- A `/templates` editor, template inheritance/reset UI, `templateList` seeding (P2).
- Interpolation/animation of section moves, undo/redo, multi-user conflict resolution, and editing
  on the display itself (in-place WYSIWYG) — the display only *navigates* to the editor.
- Replacing the device registry editor (`#/devices`) — the layout editor links to it.
