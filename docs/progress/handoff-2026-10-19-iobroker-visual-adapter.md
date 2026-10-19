# Handoff — 2026-10-19 — the layout sheet, finished

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`, head `77e405b` — clean. Carried A41 (a tile can have no name) and A42 (the tree's accordion + its own scroll) as `2420e80`; the sheet landed on top as a fast-forward. |
| **Sheet work** | Done and merged. The worktree `…\worktree\c399be\spike\layout-sheet` (branch `feature/layout-sheet`) was removed after the merge; only this checkout remains. |
| **Dev server** | `npx vite dev --port 5200` (may still be running; the browser needs Host:Port `192.168.178.9:8081` and Namespace `0_userdata.0.Test.AiHome` set once in the footer). |

Everything is committed. Nothing is pushed; no packaging. **Merged** into `feature/ihome-display` as a fast-forward (`2420e80..77e405b`); the branch and its worktree are gone.

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

- The sheet's "does this tile have a detail page?" read only the slots' `where`. It now asks **the tile itself**: the sheet keeps a hidden `Tile` mounted (its "modal view") and reads the `onDetail` callback — the same resolution the display renders, so raw slots, active rules, badge chips and frame rows all count.
- A48 (a click in the display selects the tile) did not exist. It now does: `src/lib/config/tile-hit.ts` (`placementAt()` + `placementUnder()`) + a `.pick-layer` over the display in `src/routes/+page.svelte`, handing a `picked` anchor to the sheet. The layer walks the tiles' own boxes, because the stage is `inert` and inert content is not hit-tested.

**A real bug found and fixed on the way:** the app bar's pencil used to set its own handoff (`{pageId: currentId}`) — a leftover from the tree's folding — which **clobbered a handoff already in flight**. A tile handed off from the display, or from the devices page's "Back to the tile", arrived as its *page* instead of the tile. Fixed in `3911929`.

## The plan, and where it got to

`docs/superpowers/plans/2026-10-19-ihome-layout-sheet.md` — six tasks, executed natively.

- [x] **Task 1 — the cursor as a pure module** (`3911929`): `src/lib/config/sheet-cursor.ts` with `sheetCursor()`, `swapDecision()` and `tileLabel()`, eight tests, wired into the sheet. Also removed the pencil's handoff clobber.
- [x] **Task 2 — a tile's parts as one helper** (`0439268`): `src/lib/config/tile-parts.ts`, seven tests. It takes `{pool, time, now}` in its options so the module needs no stores; `Tile` passes them.
- [x] **Task 3 — both consumers use it** (`106310d`): `Tile.svelte` keeps only its presentation mapping; `LayoutDetails` loses `showPreview` and A33's docked preview. (The sheet's own `tileParts` call for the Detail Page checkbox was later replaced by the hidden `Tile`'s report — see the review pass.)
- [x] **Task 4 — A48, click a tile in the display** (`1f93457`): `placementAt()` (and `placementUnder()` after the review), five tests; tile roots carry `data-page-id` / `data-section-id` / `data-placement-id`; `.pick-layer` over the display while the sheet is open; `picked` selects the tile, and the page moves in the click itself.
- [x] **Task 5 — retire** (`c96101d`): `LayoutTree.svelte` deleted (nothing imported it), stale `onMount` import dropped from `PageView`; every `pages.js` export has a live consumer.
- [x] **Task 6 — the ledger and this handoff** (this file; the ledger entry is in the worktree).

Browser checks for Tasks 3 and 4 were made with the real mouse, read-only: the display renders unchanged; the Detail Page checkbox is enabled on the frame tile and disabled with its tooltip on an all-on-tile tile; the non-modal dialog opens over the display and its own Close unticks the box; a click on a tile moves the sheet's cursor, a click on a heading or a gap changes nothing; the sheet's page selector reflows the display; closing the sheet removes the layer and the display becomes interactive again.

## The finishing review, and what it changed (`77e405b`)

A subagent reviewed `945f1a8..f9417bf` against A43–A50 and found **one Critical and seven Importants**; all are fixed, each re-verified read-only in the browser on the final tree:

- **Critical** — the picked-tile effect called `onPage(setLastPage)`, which reads the display's page, so the effect re-ran on *every* page change and dragged the cursor back to the old pick: after clicking a tile, the sheet's Page selector silently refused to change pages. The page now moves in the click itself (`+page.svelte pick()`), the effect only selects, and a pick is spent when the sheet closes (reopening no longer jumps back, and a stale pick cannot clobber a handoff in flight).
- **App bar tabs** navigated away from the editor instead of moving it — SvelteKit's router handled the click before a delegated `onclick` could prevent it, so the handler is now **capture-phase** and prevents the default only while the sheet is open (a closed sheet still navigates).
- A deleted selected **tile** now falls back to its section's first (A45), like pages and sections already did.
- The display is **keyboard-inert** too (`inert` on a `.stage` wrapper; the pick layer is `tabindex="-1"`), and since inert content is not hit-tested, the pick walks the tiles' boxes (`placementUnder()`) instead of `elementsFromPoint`.
- **A50** resets `mode` and `creating` when the tile changes, not only the modal view.
- The **Detail Page checkbox** is answered by the sheet's own hidden `Tile` (`onDetail`), not a second `tileParts` call with missing inputs — it is exactly the resolution the display renders.
- The sheet **mounts with no page** at all, so "Add page" is reachable again after deleting the last page.
- A **cancelled device swap** puts the selector back (its value expression never changed, so Svelte left the rejected device showing).
- Deleted while there: `Tile`'s dead `modalPreview` prop, branch and CSS (A33/A34 retired), and the "the tree … still names it" tooltip text.

Verified after the fixes: pick → sheet page change follows (no snap-back); an app bar tab moves the sheet and leaves the URL at `#/` (and still navigates with the sheet closed); close/reopen lands without the old pick; `.stage` inert and a tile control cannot take focus; the frame tile's checkbox opens the non-modal dialog and **unticking closes it** (the ask can be withdrawn now); a tile with nothing in the detail page stays disabled; device mode resets on a pick; the display's own body-tap modal still opens and closes. Left as a Minor: internal "tree" wording in comments and variable names (only the user-facing tooltip was fixed).

## Gates

`npm test` (351, 30 files) · `npm run check` (0/0) · `npm run lint` · `npm run build` — all green at `77e405b`, re-run on the merged result in the main checkout. Browser checks are read-only against the live document; **never write to it while verifying** — a write is the user's call.

## Open items

- **The device selector is a flat list.** Fine at ten devices; with many it wants the search/filter picker back (for the change action only). The rich `DevicePicker` is still there, used only for adding tiles.
- **The tile editor's own length** (A49) — its field groups are all expanded; making them fold-outs like the slot rows is a separate design.
- **A "Devices" entry on the display** — the editor being inline means the app bar shows only page tabs, so `#/devices` is reachable through a tile's Device line (and the URL). One line to add a tab or a settings icon, if wanted.
- **The ledger** lives at `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md` in this checkout — Tasks 37–60, including the sheet and the review pass (the worktree's copy was untracked, so it was appended by hand before the worktree was removed). `.superpowers/sdd/.gitignore` keeps it out of git.
