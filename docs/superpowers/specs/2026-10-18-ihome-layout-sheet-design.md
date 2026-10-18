# iHome — the layout sheet (design)

Date: 2026-10-18 · Status: **for review** (nothing implemented beyond the spike)
Branch: `feature/layout-sheet` · Spike commits: `0532e6a`, `b885aaa`, `76eec53`

The layout editor stops being a page with a tree beside a pane, and becomes a
**sheet over the live display**: the display of the page you are editing is the
preview, and the editor is three selector lines and the tile's own editor.

This supersedes **A29** (the tree's page tab highlight), **A40** (an add reveals
itself in the tree) and **A42** (the tree's accordion and scroll). The document
format, the display and every tile/slot feature (A1–A41) are untouched.

## Why

- The tree grew with the document. Measured on the live document: **1994 px of
  tree with 34 sections open**; A42's accordion was a patch over that, not a
  cure. In this shape the list is gone: three lines, whatever the document size.
- Two panes side by side are cramped exactly where the wall lives — a tablet.
- Editing meant *leaving* the display, which is the only thing that tells you
  whether the edit is right. With the display behind the sheet, an edit and its
  result are the same screen.

## What it is

- **Page line → section line → tile line → the tile's editor.** Each line is a
  selector plus its own actions; the tile's editor (today's `LayoutDetails`
  content, unchanged) is the sheet's body.
- **The display behind** renders the page the cursor names, at its real
  breakpoint, **inert** — a stray tap must not switch a lamp.
- **Wide screens:** the sheet takes the right-hand strip and the display keeps
  the rest, reflowing into what it gets. **Narrow (≤820 px):** the sheet becomes
  a bottom sheet and the display keeps the top strip.
- **Modal view:** a button on the tile line opens the *real* modal over the
  sheet. It appears only when the tile actually has something in the modal.
- **Click a tile in the display** → the three lines jump to it.
- A **close (×)** in the sheet's header returns to the display.

## Decisions

| # | Decision |
|---|----------|
| A43 | **The editor is a sheet over the live display.** The layout route renders the display of the page being edited (the real `PageView`) and the editor sheet on top of it. The display is **inert** (`pointer-events: none`): it is a preview, and nothing on it may act. It is a **right-hand sheet** on wide screens — the display is inset by the sheet's width and reflows — and a **bottom sheet** (62 vh) at ≤820 px, where a right-hand sheet would cover everything. The sheet carries the document's state badges (not saved / not editable) and a close that returns to the display. The route still owns the URL, so the handoff, a bookmark and a reload all keep working — this is why the editor stays a route and does not become a modal launched from the display. |
| A44 | **Three selector lines, no list.** Page (selector + page settings fold-out + add + delete), section (selector + section settings fold-out + add + duplicate + delete), tile (selector + add + duplicate + move up/down + remove). The tile's editor sits below the tile line; the page's and the section's own fields sit behind their `tune` fold-outs, which are closed by default. A tile's option label carries what you need to choose it: **`name · w×h`** (`Heizung · 6×4`). There is no insert-at-position any more — a tile is added at the end (the picker selects what it made) and moved with ↑/↓ — because with no list there is nothing for "above/below" to point at. |
| A45 | **One cursor.** The sheet's state is `pageId` / `sectionId` / `tileId`; the editor's `selection` derives from it (a page selection for the page fold-out, a section selection for the section fold-out, a tile selection for the editor). Every fallback is defined: a missing or deleted page falls back to the first page, a section to the page's first, a tile to the section's first — so the sheet always shows something and no state can dangle. The display behind renders the cursor's page. The handoff (`requestLayoutConfig`) and a click in the display (A48) both set the cursor. |
| A46 | **The display is the preview.** A33's docked preview (the tile on its section's colour) and A34's modal preview (the modal rendered inline under the fields) both retire: the display behind shows the tile in its real page, and the detail page gets its own view instead (A47). `PageView` takes its breakpoint from **its own container**, not the window, so the display reflows into the space the sheet leaves it — on the wall this is the same width as before. |
| A47 | **The detail page is a non-modal dialog over the display.** A checkbox labelled **Detail Page** sits on the tile editor's heading line, to the right of the tile's name, and shows what a long-press opens. The sheet renders its **own hidden `Tile`** — only the tile resolves its modal's rows and badges, so the sheet must not rebuild them — and asks it for the dialog in its **non-modal** form (`show()` instead of `showModal()`). Non-modal is the point: it blocks nothing, so the sheet stays fully usable while you look at it, and it is positioned over the display (the strip the sheet leaves) rather than over the editor. Closing is unmounting: untick the box (or use the dialog's own close, which unticks it) and the `Tile` goes away, dialog with it — there is no "close" request that could go stale. The checkbox is always present and **disabled, with a tooltip, when the tile has nothing in the detail page**, asked of the same resolution the tile uses (the spike approximates this from the slots' `where`; the real pass extracts one helper both use). Two consequences: a non-modal dialog is not in the browser's top layer, so it lives by ordinary stacking (a future overlay could cover it), and on a narrow screen it takes the strip above the bottom sheet. |
| A48 | **Clicking a tile in the display selects it.** A transparent selection layer covers the stage and turns a click into the placement beneath it (`elementsFromPoint` → the tile's `data-placement-id`), then sets the cursor. The display's own gestures never fire in the editor: no tap switches a lamp, no long-press opens a modal (that is A47's button), so "the editor is inert" and "you can point at what you want to edit" hold at the same time. |
| A49 | **The tile editor's own length is not part of this pass.** Its field groups (background, history, active, template, move to section) stay expanded, as today. Making them one-line fold-outs the way slot rows already work is a separate change to `LayoutDetails` and deserves its own design. |

## What retires

- `LayoutTree.svelte` and its fold rules (A40's reveal, A42's accordion), the
  route's two-column grid and the tree's sticky scroll.
- A33's docked preview and A34's modal preview (A46).
- The `focus` handoff split: with no tree there is nothing to fold, so a handoff
  is only "set the cursor" (the route's `focus` state goes).

## Tests

Pure logic worth pinning, next to the existing suite:

- the cursor's fallbacks (A45): a page/section/tile that no longer exists falls
  back to the first, and a section of another page is not honoured;
- the tile line's label: `name · w×h`, with and without a size, with and without
  a title (falls back to the device's name);
- the modal-parts helper (A47): a slot in `modal`/`both` counts, a slot in
  `tile` does not, a rule-hidden slot does not (this is the extraction the real
  pass makes, replacing the spike's approximation);
- the stage's click mapping (A48): a click on a nested element resolves to its
  placement, a click on empty space resolves to nothing.

Component behaviour (the sheet's layout, the bottom/right switch, the inert
stage, the modal over the sheet) is verified in the browser against the live
document, as the rest of this project's UI is.

## Not in this pass

- The tile editor's own fold-outs (A49).
- Long-press gestures on the display's headings (the earlier idea of a touch
  path to the editor): the sheet has its own entry points now (the pencil in the
  AppBar, and A48's click), so this needs a fresh look rather than a carry-over.
- Per-surface behaviour of the display's own gestures while the sheet is open
  (there are none by design — A43/A48).

## Open questions

- With no list, the tile line's ↑/↓ are the only way to position a tile and its
  position is invisible (the select's order and the display are the cues). Keep
  them, or is the position worth showing on the line (`3 / 7`)?
