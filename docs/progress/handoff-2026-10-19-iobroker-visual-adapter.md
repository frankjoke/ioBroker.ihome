# Handoff — 2026-10-19 — the layout sheet, finished

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`, head `2420e80` — clean. Carries A41 (a tile can have no name) and A42 (the tree's accordion + its own scroll). |
| **Sheet work** | worktree `C:\Users\franz\.local\share\opencode\worktree\c399be\spike\layout-sheet`, branch `feature/layout-sheet`, head `c96101d` — clean (`.superpowers/` is untracked and gitignored). Cut from `2420e80`, so merging it into `feature/ihome-display` brings everything. |
| **Dev server** | `npx vite dev --port 5200` from the worktree (may still be running; the browser needs Host:Port `192.168.178.9:8081` and Namespace `0_userdata.0.Test.AiHome` set once in the footer). |

Everything is committed. Nothing is pushed; no packaging. **Not merged yet** — the merge into `feature/ihome-display` is the user's call.

## What the layout sheet is

The editor stopped being a page with a tree beside a pane and became a **mode of the display**:

- `#/` stays the URL. The app bar's icon is the mode indicator — pencil opens the sheet, eye closes it. The display behind is the *same* instance; a transparent layer over it makes it **inert** and turns a click into a selection (A48).
- Four selector lines: **Page → Section → Tile → Device**, each with its own actions, and one editor at a time below them (the tile's layout, or the tile's device — the Device line's switch swaps the body).
- The tile's editor has a **Detail Page** checkbox on its heading line, which opens the tile's real modal **non-modally over the display** (nothing blocked, the sheet stays usable).
- The Device line is a plain selector (picking a device *is* the change action, with A25's confirm for a tile carrying its own config) plus add and delete for the registry.
- The display's breakpoint follows **its own container**, so it reflows beside the sheet (right-hand sheet on wide, bottom sheet ≤820 px).

Design record: `docs/superpowers/specs/2026-10-18-ihome-layout-sheet-design.md` (**A43–A50**); A29/A40/A42 in the tile-editor spec are marked superseded.

## What was built how

The whole shape was prototyped in this branch as a **spike** (commits `0532e6a` … `56f8440`) and verified in the browser at desktop and tablet sizes, read-only against the live document. The spike approximated two things; the finishing plan replaced both:

- The sheet's "does this tile have a detail page?" read only the slots' `where`. It now asks **`tileParts()`** (`src/lib/config/tile-parts.ts`), the same resolution `Tile.svelte` uses to render — so rules, templates and frame slots all count correctly.
- A48 (a click in the display selects the tile) did not exist. It now does: `src/lib/config/tile-hit.ts` + a `.pick-layer` over the display in `src/routes/+page.svelte`, handing a `picked` anchor to the sheet.

**A real bug found and fixed on the way:** the app bar's pencil used to set its own handoff (`{pageId: currentId}`) — a leftover from the tree's folding — which **clobbered a handoff already in flight**. A tile handed off from the display, or from the devices page's "Back to the tile", arrived as its *page* instead of the tile. Fixed in `3911929`.

## The plan, and where it got to

`docs/superpowers/plans/2026-10-19-ihome-layout-sheet.md` — six tasks, executed natively.

- [x] **Task 1 — the cursor as a pure module** (`3911929`): `src/lib/config/sheet-cursor.ts` with `sheetCursor()` and `swapDecision()`, six tests, wired into the sheet. Also removed the pencil's handoff clobber.
- [x] **Task 2 — a tile's parts as one helper** (`0439268`): `src/lib/config/tile-parts.ts`, seven tests. It takes `{pool, time, now}` in its options so the module needs no stores; `Tile` passes them, the sheet passes none (and counts modal badge slots instead of resolving chips).
- [x] **Task 3 — both consumers use it** (`106310d`): `Tile.svelte` keeps only its presentation mapping; the sheet's `hasDetail` is `tileParts(...).hasModal`; `LayoutDetails` loses `showPreview` and A33's docked preview.
- [x] **Task 4 — A48, click a tile in the display** (`1f93457`): `placementAt()`, four tests; tile roots carry `data-page-id` / `data-section-id` / `data-placement-id`; `.pick-layer` over the display while the sheet is open; `picked` prop sets the cursor and the display's page.
- [x] **Task 5 — retire** (`c96101d`): `LayoutTree.svelte` deleted (nothing imported it), stale `onMount` import dropped from `PageView`; every `pages.js` export has a live consumer.
- [x] **Task 6 — the ledger and this handoff** (this file; the ledger entry is in the worktree).

Browser checks for Tasks 3 and 4 were made with the real mouse, read-only: the display renders unchanged; the Detail Page checkbox is enabled on the frame tile and disabled with its tooltip on an all-on-tile tile; the non-modal dialog opens over the display and its own Close unticks the box; a click on a tile moves the sheet's cursor, a click on a heading or a gap changes nothing; the sheet's page selector reflows the display; closing the sheet removes the layer and the display becomes interactive again.

## Gates

`npm test` (346, 29 files) · `npm run check` (0/0) · `npm run lint` · `npm run build` — all green at `c96101d`. Browser checks are read-only against the live document; **never write to it while verifying** — a write is the user's call.

## Open items

- **The device selector is a flat list.** Fine at ten devices; with many it wants the search/filter picker back (for the change action only). The rich `DevicePicker` is still there, used only for adding tiles.
- **The tile editor's own length** (A49) — its field groups are all expanded; making them fold-outs like the slot rows is a separate design.
- **A "Devices" entry on the display** — the editor being inline means the app bar shows only page tabs, so `#/devices` is reachable through a tile's Device line (and the URL). One line to add a tab or a settings icon, if wanted.
- **The ledger** lives at `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md` — in the *main* checkout for Tasks 37–51, in the worktree for the sheet (it is gitignored, so it does not travel with the branch).
