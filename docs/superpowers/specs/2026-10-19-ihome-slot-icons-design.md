# Design — iHome slot icons (P3: the icon lives on its slot)

**Date:** 2026-10-19
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Status:** design approved in conversation; spec for implementation planning
**Depends on:** `2026-10-14-ihome-display-design.md` (A1–A7, slots and rules),
`2026-10-15-ihome-layout-editor-design.md` (A8–A17, the tree and placements),
`2026-10-16-ihome-tile-editor-design.md` (A18–A42, the tile editor and its model rules),
`2026-10-18-ihome-layout-sheet-design.md` (A43–A50, the sheet)
**Scope:** one icon per slot, dressed by the slot's own rules; the **headline slot's** icon is the
tile's face (tile accent, detail header); a slot icon gets its own display home (tile / both /
detail); the legacy `kind: "icon"` slot keeps rendering and editing as today and gains a
user-initiated conversion. No icon-specific rules UI, no icons on badges/frames through the editor,
no per-icon animation, no cross-device icons, no uploads.

## 1. Intent

Today the icon is a slot of its own (`kind: "icon"`), first in every preset. Four costs:

1. **The glyph cannot be changed in the editor.** `options.icon` has no field anywhere; only a
   rule's icon picker can override it, and the `device.icon` fallback has no UI at all.
2. **The pairing is implicit.** An icon is the decoration of a reading — the thermometer glyph
   belongs to the temperature — but a standalone slot only says so by matching source strings.
3. **Secondary readings cannot carry icons.** Dew point, setpoint, humidity: nothing, ever.
4. **The detail page shows the icon wrong.** By default it does not show at all; switched to
   `both`/`modal` it appears as a labelled row, where the tile's icon belongs in front of the name.

Success criteria:

1. Every data-bearing slot can carry its own icon: enabled, glyphed, and dressed by state rules —
   configured in the editor, live on the display.
2. The main value/function slot ships with its icon enabled (presets), and that icon appears with
   the value on the tile and in front of the name on the detail page; disabling is one toggle.
3. An icon can live in the detail page only, or on the tile only.
4. Nothing stored changes silently: materialised tiles and saved templates render exactly as today
   until the user converts them or resets them.
5. A type's default icon and every per-tile change are editor-only — no code change needed.

## 2. Decisions

Terminology, used strictly below: **icon slot** = the legacy `kind: "icon"` slot; **slot icon** =
the new per-slot icon descriptor.

| # | Decision |
|---|---|
| A51 | **A slot can carry an icon.** `Slot.icon?: SlotIcon` (`{ glyph?, enabled?, where? }`, §4). No descriptor → no icon. `enabled: false` keeps glyph and rules in place but renders nothing — the "defined but not visible" state; re-enabling restores exactly what was there. The icon has **no placeholder**: its glyph is the last matching rule's `icon`, else `icon.glyph`, else nothing renders (the legacy chain's `device.icon`/`widgets` fallbacks do not apply to slot icons). The slot's **own rules dress the icon** — `icon` swaps the glyph, `color`/`glow`/`disabled` style it — exactly what the icon slot's rules did; a rule icon on a slot whose icon is not enabled stays dormant (never a phantom). |
| A52 | **The headline slot is the tile's face.** Headline = the first `value` slot of the tile's slot list (config order), else the first slot that is not a legacy icon slot (a legacy Button tile's face is its button, not its old icon slot). When its icon is enabled and its `where` allows the detail home, that icon renders in front of the tile's name on the detail page (A54). Its resolved style drives the tile accent/glow/background exactly as the first icon slot did — independent of whether its icon is enabled, so "glow when on" keeps working icon-less. **Compatibility:** while a tile still carries a legacy icon slot, *that* slot keeps driving the accent (a legacy tile renders exactly as today); the headline takes over once none remains. Text emphasis is unchanged: the first value **row rendered in the body** keeps the big bold reading (with the headline present they coincide; a `modal`-only headline is the documented edge). Verified: this fold reproduces all eleven presets' icon sources exactly. |
| A53 | **The icon renders with its slot, wrapping.** In the tile body a slot with a visible icon renders icon + content as one cluster: icon left of the content when the line fits, above it when not — pure CSS flex-wrap, no config, so it holds at every span and breakpoint. Sizes follow emphasis: the emphasised reading keeps today's large glyph (34 px), secondary icons sit at reading size (~17 px; exact values settled against the preview). No icon → no space reserved. A dormant slot (A20) renders nothing, so its icon comes alive together with the slot — dormancy stays data. |
| A54 | **The detail page: the icon moves to the name; rows read icon → name → value.** The header shows the headline's icon before the tile name (the header counts as the detail home). Each row renders its slot's icon before the row label; values stay right-aligned. Home rule: an icon renders where its slot renders **and** its own `where` allows it (`tile` / `both` / `modal`, absent = `both`); the header is the one place a `modal`/`both` headline icon shows even when its slot itself lives only on the tile. A `tile`-only headline icon does not greet the name. The slot's own visibility (`showWhen`, `hidden`/`only`) always wins for rows; the header follows the icon's own `enabled`/`where` only. Frame slots: their icon precedes the frame block. |
| A55 | **Presets are re-authored; the fold is mechanical.** Each preset's `icon(source, glyph, rules)` entry folds into the slot carrying the same source: `icon: { glyph }` + the icon slot's rules appended **after** that slot's existing rules (last match wins; no preset target has rules today). The fallback target is the headline slot (needed for hint-based presets: Thermometer's icon folds onto its first value slot, Value's onto its bare value, both via the headline). A **preset-integrity test** pins the mapping. Unmaterialised tiles adopt the new look on ship: 1×1 tiles look unchanged, wide ones (Thermostat, Blind, AC) put the icon beside the reading — the intended change. |
| A56 | **Legacy icon slots stay, and convert on request.** `kind: "icon"` remains valid stored configuration: rendering (`IconSlot`, including the rule → `options.icon` → `device.icon` → `widgets` chain) and editing are unchanged, and **new configuration never creates one** (the `+` picker drops the entry; the editor's kind select offers `icon` only on a legacy row). The tile editor offers **Move into its slot** on a legacy icon slot — one atomic store edit: target = the first slot with the same `source` (the icon slot itself excluded), else the headline, else the action is disabled (nothing to move onto); the target gets `icon = { glyph, where }` (the icon slot's explicit `where` carries; absent stays absent = `both`) with the icon slot's rules appended after the target's, and the icon slot is removed. A confirm names the consequences: an existing icon on the target is overwritten; the icon slot's own `showWhen` is not carried — afterwards the icon follows the target slot's visibility; a default (tile-only) icon slot becomes visible wherever the target slot lives, plus the detail header when the target is the headline (the slot icon's default home). Nothing is ever rewritten silently; **Reset** remains the blunter path (re-materialise from the new preset). |
| A57 | **Editor: one Icon block per slot.** The expanded slot pane gains, between the hint/knobs rows and the rules block: an **icon toggle** (on → descriptor `enabled: true`, off → `enabled: false`, both keeping glyph and rules; a fresh enable with no glyph shows a small "no glyph yet" hint rather than a placeholder), a **glyph field + Choose…** (the existing `IconPicker`, unchanged: symbols / document / broker / URL), and the icon's **`where`** as the same tri-state control the slot uses (default *both*; choices that can never render are disabled — a slot that only lives in the modal cannot take a tile-only icon; the header keeps `modal`/`both` meaningful for a tile-only **headline**). The block is offered on the data-bearing kinds (`value`, `level`, `color`, `enum`, `button`); the renderer stays generic (it renders any descriptor it finds). The collapsed slot row shows a tiny glyph preview; the headline slot carries a **headline** tag (why its icon is the big one, the header's, and the accent's). Legacy icon slot rows get a **not-a-slot-any-more** marker and the A56 action. The rules block gains one note: rule icons render only while the slot's icon is enabled. |
| A58 | **One rules list per slot.** There is no icon-specific rules UI: the slot's rules *are* the icon's rules. (The reading's own text styling by rules — colouring a value, animating a badge — stays out of scope.) |

## 3. Architecture

No new mechanisms — the existing resolution chain gains one field and one visible decision:

```
Slot.icon (glyph, enabled?, where?)  +  Slot.rules (icon / colour / glow / disabled)
        │
tile-parts (pure, one place):
        ├─ headline pick: first value slot, else first slot        → accent source, header icon
        ├─ per-row icon decision (enabled ∧ where ∩ homes ∧ slot renders)  → tile cluster, modal rows
        └─ legacy pass-through (kind "icon" rows untouched)
        │
        ├─ Tile.svelte / SlotRenderer.svelte: wrapping cluster per body row
        ├─ ModalPanel.svelte: header icon before the name; rows icon → label → value
        └─ LayoutDetails.svelte (the sheet's tile editor): icon block, headline tag, legacy action
```

The sheet asks the same `tile-parts` resolution for its preview (A46/A47), so the editor cannot
drift from the display. The conversion op lives in `tile-ops` with the other tile mutations.

## 4. Data model

`src/lib/types/display.ts` (all optional; existing documents stay valid):

```ts
export interface SlotIcon {
  glyph?: string;    // one raw string, A23: symbol name, image URL, data: URL or broker path
  enabled?: boolean; // absent = enabled while the descriptor exists
  where?: "tile" | "both" | "modal"; // the icon's own homes, absent = both (narrowed by Slot.where)
}

export interface Slot {
  /* kind, source, from?, label?, unit?, options?, rules?, showWhen?, where? — unchanged */
  icon?: SlotIcon;
}
```

The `where` vocabulary deliberately matches `Slot.where` with a different default: a slot renders
on the tile unless told otherwise; an icon shows wherever its slot lives unless told otherwise.

### 4.1 Model rules

1. **Presence gates rendering**: no descriptor → no icon; `enabled: false` → nothing (values kept).
2. **Glyph chain**: last matching rule's `icon` → `icon.glyph` → nothing. Legacy icon slots keep
   the old chain (rule → `options.icon` → `device.icon` → `widgets`).
3. **Homes**: tile cluster iff the slot renders on the tile ∧ `where ∈ {tile, both}`; modal row
   likewise for `{modal, both}`; header iff the **headline** icon is enabled ∧
   `where ∈ {modal, both}` (the header is the detail home; its slot need not render there).
4. **Dormant slots** render nothing — icon included; the icon comes alive with the slot.
5. **Legacy coexistence**: a legacy icon slot and slot icons render independently; a converted
   tile simply no longer has the former.
6. **Accent source**: the first legacy icon slot while one exists (exactly today's behaviour);
   otherwise the headline slot's resolved style. Enabling/disabling an icon never changes the
   accent (status behaviour must work icon-less).
7. **Conversion** (`foldIconSlot(tile, iconSlotIndex)`): per A56; pure, returns a new
   `TileConfig`, no-op when there is nothing to fold.

## 5. Renderer

1. `SlotRenderer.svelte`: a body slot with a visible icon gets a `.slot-cluster` wrapper
   (flex, wrap, small gap) around icon + the kind component; without one, rendering is as today.
   Icon size by the existing `emphasis` prop (headline large, secondary reading-size).
2. `Tile.svelte`: `tileStyle`'s source changes from "first icon slot" to A52's accent source
   (legacy icon slot if present, else the headline). Text/badge/chart logic untouched.
3. `ModalPanel.svelte`: header renders the headline icon before the `h2`; each row renders its
   icon before the row label; frame rows render the icon before the block. Row icons use the same
   resolved decision as the tile (from `tile-parts`), never a second guess.
4. Legacy `IconSlot` rows render exactly as today (no cluster wrapper — the old standalone flow).

## 6. Editor UI

`LayoutDetails.svelte`, per A57; `SlotPicker.svelte` drops the `icon` entry from its kind list.
Everything else in the pane (source, label/unit/hint, per-kind knobs, templates, move, preview)
is unchanged. The toggle writes through a small `patchIcon` helper (set/clear fields, drop empty
descriptors) so the document never accretes empty `{}` icons.

## 7. Error handling

| case | behaviour |
|---|---|
| icon glyph is a broken URL | the `<img>` breaks visibly, value stays raw and fixable (A23's rule) |
| icon enabled, no glyph anywhere | nothing renders; the editor shows "no glyph yet" |
| conversion target has an icon already | overwritten, after the confirm says so |
| conversion target missing (no source match, no other slot) | action disabled with a tooltip |
| converted icon slot had `showWhen` | not carried; the confirm says the icon will follow the target slot's visibility |
| dormant slot with an icon | stays dormant (icon with the slot); it comes alive when the control resolves |
| unreadable document | saving stays disabled (existing gate) |

## 8. New/changed files

| file | change |
|---|---|
| `src/lib/types/display.ts` | `SlotIcon`; `Slot.icon` |
| `src/lib/config/presets.ts` | all eleven presets re-authored (A55) |
| `src/lib/config/tile-parts.ts` | headline pick; per-row icon decision; legacy pass-through |
| `src/lib/config/tile-ops.ts` | `foldIconSlot`; `patchIcon` |
| `src/lib/components/display/SlotRenderer.svelte` | the wrapping cluster |
| `src/lib/components/display/Tile.svelte` | accent source (A52) |
| `src/lib/components/display/ModalPanel.svelte` | header icon; row icons |
| `src/lib/components/layout/LayoutDetails.svelte` | icon block, headline tag, legacy marker + action |
| `src/lib/components/layout/SlotPicker.svelte` | no `icon` entry for new slots |
| tests: `presets`/`tile-parts`/`tile-ops` | A55 mapping, A54 homes, enable gate, dormancy, accent source, conversion (order, overwrite, no-target, no-op), `patchIcon` hygiene |

## 9. Testing & verification

- **Pure, vitest** (repo style): preset-integrity (each preset: exactly one slot icon, on the
  expected slot); headline pick (value-first / else-first, config order); icon decision matrix
  (enabled, `where` × homes, header exception, dormant); accent source (legacy present vs not);
  `foldIconSlot` (source match, headline fallback, rule append order, descriptor set, overwrite,
  disabled/no-target, no-op); `patchIcon` (never writes empty descriptors).
- **Live browser pass** (read-only against the real broker, per repo convention): an
  unmaterialised tile at 1-wide and 2-wide (icon above / beside), a materialised legacy tile
  unchanged + conversion offered in the editor, the detail page (header icon before the name,
  rows icon → name → value), the editor icon block (toggle, picker, where), the headline tag.
  No intended broker writes: converting a real tile is the user's click, not the pass's.
- **Gates before "done":** `npm test`, `npm run check` (0/0), `npm run lint` (0), `npm run build`.

## 10. Phases

1. **Types + pure ops + preset fold** (no UI): `SlotIcon`, headline/decision helpers,
   `foldIconSlot`, `patchIcon`, presets re-authored, all tests.
2. **Renderer**: cluster, accent source, modal header/rows — verifiable on the display.
3. **Editor**: icon block, `patchIcon` wiring, picker change, legacy marker + action.
4. **Live verification pass** + gates, then the handoff document.

## 11. Risks

| risk | mitigation |
|---|---|
| wide unmaterialised tiles change look (icon moves beside the reading) | intended and previewed; 1×1 tiles are unchanged; conversion is per tile for materialised ones |
| two mechanisms coexist until conversion | both paths tested; the legacy row is marked and the conversion is one click; Reset is the blunt alternative |
| previously inert rule styles become visible on data slots that get an icon | only ever after a descriptor is added (new configuration); no stored document changes retroactively |
| the wrap cluster shifts body layout on tiles with icons | pure CSS with the existing emphasis sizes; verified at 375/820/1400 against the preview |
| conversion is manual, so old tiles stay legacy-shaped for long | marker + action + Reset; no silent rewriting by design |

## 12. Non-goals

- Icon-specific rules UI (A58: one list), text styling by rules, icons on badge/frame/sparkline/
  history-list slots through the editor (the renderer stays generic).
- Per-icon animation, icon-only tiles, cross-device icons (`Slot.from`, S2), uploads/data-URLs in
  the document (A23), the `/templates` library page.
- Retiring `kind: "icon"` — scheduled for whenever the live document no longer carries one.
