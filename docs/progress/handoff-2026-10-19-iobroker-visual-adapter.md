# Handoff — 2026-10-19 — the slot icons (A51–A58)

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`, head `0c6c85f` — clean. The spec and the plan for this slice are committed there. |
| **Slot-icons work** | Worktree `…\worktree\c399be\slot-icons`, branch `feature/slot-icons` (from `0c6c85f`). Six task commits + this handoff. **Not merged** — merging into `feature/ihome-display` is the user's call. |
| **Ledger** | `.superpowers/sdd/2026-10-19-ihome-slot-icons/progress.md` in the worktree (five task lines, two rulings, pre-flight scan). |
| **Dev server** | The user's runs on :5173; the checks here ran on a second one at :5174. Either needs Host:Port `192.168.178.9:8081` and Namespace `0_userdata.0.Test.AiHome` set once in the footer. |

Design record: `docs/superpowers/specs/2026-10-19-ihome-slot-icons-design.md` (**A51–A58**); plan:
`docs/superpowers/plans/2026-10-19-ihome-slot-icons.md`.

## What the slot icons are

The icon stopped being a slot of its own and became **a property of the slot it decorates**:

- `Slot.icon = { glyph?, enabled?, where? }` — no descriptor, no icon; `enabled: false` keeps glyph and
  rules but renders nothing; `where` is the icon's own home (tile / both / modal, default both, narrowed
  by the slot's own `where`). The slot's **existing rules dress it**: a rule's `icon` swaps the glyph,
  `color`/`glow`/`disabled` style it — no second rules list.
- The **headline slot** (first value slot, else first non-icon slot) is the tile's face: its icon renders
  with the value — side by side from a 2-wide span, **stacked (icon above the value) at 1-wide** — and it
  greets the tile's name in the detail header. Its resolved style drives the accent/glow as before.
- The **eleven presets** carry their icon on the slot its source named (folds are pinned by a test); no
  preset creates an `icon` slot any more, and the `+` picker no longer offers one.
- **Legacy `kind: "icon"` slots keep rendering and editing exactly as today** — including the detail
  page's labelled row. The tile editor marks them **legacy** and offers **Move into its slot** (a
  confirm; glyph, rules and home move onto the named slot, rules appended last; the icon slot is
  removed). Nothing is rewritten silently; Reset remains the blunt path.
- Editor: every data-bearing slot (value/level/color/enum/button) gets an **Icon** block — toggle, glyph
  field + Choose…, the where cycle; the collapsed row shows a glyph preview, and the headline slot wears
  a **headline** tag. Legacy rows show the fold button, disabled with a tooltip when there is no target.

## Bug found and fixed live

The first read-only check caught a real defect: `Tile` resolved the template a second time, so
`r.slot === headline` compared across two arrays — chain-resolved tiles got **no 1-wide stack and no
header icon**. Fix: `TileParts` now exposes the very `slots` its rows carry, `Tile` reads them; pinned
by a new test (`feat(display)` commit, ledgered as a Ruling). Re-verified live: the chain tiles stack,
state glyphs follow the rules (`lightbulb_outline` while off, `directions_walk` while idle).

## The plan, and where it got to

`docs/superpowers/plans/2026-10-19-ihome-slot-icons.md` — six tasks, executed inline, one commit each:

- [x] **Task 1 — the descriptor and the resolution** (`9ed6225`): `SlotIcon`, `headlineSlot`, `rowIcon`,
       the picker's Document tab learns `glyph`; 355 tests.
- [x] **Task 2 — the mutations** (`8cf6981`): `patchIcon`, `iconSlotTarget`, `foldIconSlot`; 360 tests.
- [x] **Task 3 — the presets** (`e902170`): all eleven folded, integrity test; 361 tests.
- [x] **Task 4 — the renderer** (`9675a71`): cluster in `SlotRenderer`, 1-wide stack, accent source,
       header + row icons in `ModalPanel`; the identity bug above and its fix.
- [x] **Task 5 — the editor** (`1d69344`): Icon block, headline tag, legacy marker + fold confirm,
       `SlotPicker` drops `icon`.
- [x] **Task 6 — this handoff.**

## Checks (read-only, live document)

Display: legacy materialised tiles pixel-unchanged (icon slot, accent, glow, chart, frame); chain tiles
show the new look with live rule glyphs. Detail page: legacy modal unchanged — no header icon, no row
icons, the legacy icon slot still its own labelled row. Editor: Icon block (checked toggle, glyph
`device_thermostat`, Choose…, where "tile + modal → tile"), `headline` tag, `legacy` marker, fold button
enabled with target `value · Brunnen`, add-slot picker without `icon`. Console: no app errors — only the
frame's third-party `energiefluss` noise, Sentry timeouts and the known `templateList` warning. No
writes: nothing was toggled or confirmed on a live tile.

## Gates

`npm test` (362, 30 files) · `npm run check` (0/0) · `npm run lint` (0) · `npm run build` — all green at
`1d69344` (the full-suite run after the final fix pass is with the closing commits of this slice).

## The user's interactive checklist

These write to the live document, so they are yours:

1. **Reset** a materialised tile (e.g. Garten/Terrasse) to see the new preset look up close.
2. Add an icon to a **secondary slot** (dew point, humidity…) — pick a glyph, watch the cluster.
3. Flip a headline icon **off** (glyph and rules stay), then on again.
4. Set an icon **detail-only** (`where: modal`) — the tile stays clean, the header and its row carry it.
5. **Move a legacy icon slot** into its slot on one tile and check the confirm's wording.

## Open items

- **`kind: "icon"` retirement** — scheduled for whenever the live document no longer carries one.
- **Wide (w ≥ 2) beside-layout** was not observable read-only (no wide chain-resolved tile in the live
  document); the mechanism is the un-stacked default of the same cluster — the first wide tile you reset
  shows it.
- The interactive pass may want the size constants tuned (tile headline 34 / secondary 17 / header 26 /
  rows 18 are one-line constants).
