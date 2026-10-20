# Design — iHome slot sparklines (P4: the chart lives on its value)

**Date:** 2026-10-20 · **Status:** proposed — awaiting review before the plan.
**Depends on:** `2026-10-19-ihome-slot-icons-design.md` (A51–A58: the descriptor pattern this copies),
`2026-10-14-ihome-display-design.md` (slots, rules, the tile chart layer A22),
`2026-10-16-ihome-tile-editor-design.md` (A18–A42), `2026-10-18-ihome-layout-sheet-design.md` (A43–A50).
**Scope:** the chart becomes a property of the value slot it belongs to, with its own display home and
an optional colour; the tile draws every enabled series in its one chart area; the detail row carries
its chart between label and value; `kind: "sparkline"` retires. No legend, no chart for other kinds,
no `history-list` change, no new preset charts.

## 1. Intent

A chart is a slot of its own today. With `options.background: true` it *is* the tile's chart layer;
otherwise it is a row — which is why the detail page shows a chart on a line apart from the value it
describes, and why the tile editor must enforce "at most one background sparkline". A chart only means
something for a reading that has history, and that history is already configured per control in the
device editor (the history store fetches the series and appends live samples).

So the chart belongs to the value slot that shows the reading:

- the tile draws **all** its enabled series in the one chart area — a chart of lines, not a stack of
  charts, each line in its own colour;
- the detail row shows its value's chart **between the label and the value**;
- a value charts on the tile, in the detail, or both, and may name its own colour.

Removed by the change: a slot kind, the tile-level "one chart" control, and a second vocabulary for
the idea the icon already expresses (A51).

## 2. Decisions

| # | Decision |
|---|---|
| A59 | **The chart is a property of the value slot.** `Slot.spark = { enabled?, where?, color? }` — no descriptor, no chart; `enabled: false` keeps colour and home but draws nothing; `where` is the chart's own home, absent = `both`. `kind: "sparkline"` and `SparklineSlot.svelte` retire, together with the sparkline-only `options.background` flag and `tileParts`' `background` row list. New configuration never creates a chart slot: the `+` picker and the editor's kind select no longer offer one. |
| A60 | **The chart's home is its own.** It is not narrowed by the slot's own `where` and not gated by the row's visibility: a value whose row lives only in the modal can still feed the tile's chart, and `spark.where: "tile"` on a modal-only row draws on the tile and nowhere else. This is the deliberate difference from the icon (A51/A54, where the icon is narrowed by the slot): the chart layer was always independent of the reading's row, and a tile must not lose its line because a reading moved into the detail. A row's own chart (A62) *is* part of the row, so it follows the row's visibility like any other row content. |
| A61 | **The tile's chart (A22, replaced).** The existing chart layer keeps its geometry — absolutely positioned behind the content, centred in the tile, pointer-events none, no space reserved — and now draws every value slot whose spark is not disabled, whose home allows `tile`, and whose resolved control has history, **in slot order**. Each series is stroked in its colour: the slot's own `spark.color`, else the palette colour at that slot's index among the tile's chart-enabled values — every value slot with an enabled spark whose control has history, whatever its home — in slot order, so a value keeps its colour between the tile and the detail. The palette is the theme's `--primary-color`, `--success-color`, `--warning-color`, `--danger-color`, `--secondary-color`, in that order. Each series is normalised to its own min/max (temperature and humidity cannot share a scale); a constant series draws the flat centre line. x is **time**, not index: each series is placed by its own timestamps across the widest window of the charted specs, so a shorter history occupies the right-hand part and differently sampled series line up. Nothing is drawn until the first sample arrives — no placeholder glyph, no reserved space. There is no legend on the tile (a 1×1 tile has nowhere to put one; the detail row pairs each colour with its value). |
| A62 | **The row's chart.** In the detail page a value row reads **label → chart → value**: after the label, a middle cell that grows into the free space holds the chart (~24 px high, full width of the cell), and the value stays right-aligned; while a row has a chart the value no longer takes the growing column. Rows without a chart are unchanged, pixel for pixel. The row chart is row content: it obeys the row's visibility (`showWhen`, `only`/`hidden` rules) and needs no second `where`. |
| A63 | **Value slots only; the renderer stays generic.** The editor offers the Sparkline block on `value` slots only (a badge, frame, level, colour or enum is not a reading that owns a chart), but the renderer draws any descriptor it finds whose control can chart. A control can chart when it has a `history` spec **and** a `stateId`; a slot whose control cannot chart draws nothing (the tile silently omits the series, the row omits the chart). The editor says so: with no resolved control, or one without history, the toggle is disabled with a hint pointing at the device editor, where history is configured — this change does not move that configuration. |
| A64 | **Migration is a one-off, before the code lands** (the A56 pattern, deliberate and approved). For every `kind: "sparkline"` slot: resolve its `source` against the tile's device controls (the display's own `resolveControl`); the first `value` slot on that tile that resolves to the same control (including `pick`/`index`-based slots) gets `spark = { enabled: true, where: "tile" }` — the chart was the tile layer, and `tile` keeps the detail page as it looks today. With no such row, a `value` slot is inserted for the chart's control with the source string preserved and `where: "modal"` (the tile is visually unchanged, the detail gains the reading) plus the same spark. The sparkline slot is then removed. The write goes through the app's store (`commitLayout`), `updatedAt` is bumped, and the document is read back and verified before the retirement commit. The presets carry no sparkline, so they need no change. |

Terminology, used strictly below: **spark** = `Slot.spark`, the chart descriptor on a value slot;
**series** = one value's charted line; **chart area** = the tile's background chart layer.

## 3. Architecture

No new mechanism: the resolution chain gains one field and one derived list, and the chart component
learns to draw several series.

```
Slot.spark (enabled?, where?, color?)  +  the control's history spec
        │
tile-parts (pure, one place):
        ├─ hasHistory(control)                    → can this control chart at all
        ├─ tileSeries(rows)                       → the tile's series, slot order, colours
        └─ rowSpark(row, home)                    → one row's chart, or none
        │
        ├─ TileChart.svelte (new): N polylines in one svg; history per series
        ├─ Tile.svelte: .tile-bg renders TileChart with tileSeries(parts.rows)
        ├─ ModalPanel.svelte: label → chart → value
        └─ LayoutDetails.svelte: the Sparkline block, the patchSpark op, the retired chart dropdown
```

`tileParts` currently splits the resolved rows into `body` / `background` / `modal`, which loses rows
that live on "both" sides of the split. It will expose the full resolved row list and derive the
others from it, so `tileSeries` sees each row exactly once.

## 4. Data model

`src/lib/types/display.ts` (all optional; existing documents stay valid):

```ts
/** A slot's chart (A59): presence gates drawing, `false` keeps it defined but
 *  off, and its own home is independent of the slot's (A60). */
export interface SlotSpark {
  enabled?: boolean;                  // absent = enabled while the descriptor exists
  where?: "tile" | "both" | "modal";  // the chart's own homes; absent = both
  color?: string;                     // one raw colour; the palette when absent
}

export interface Slot {
  /* kind, source, from?, label?, unit?, options?, rules?, showWhen?, where?, icon? — unchanged */
  spark?: SlotSpark;
}
```

`SlotKind` loses `"sparkline"`. `options.background` is no longer a documented option (nothing else
ever used it). `history-list` is untouched (A63 scope).

### 4.1 Model rules

- Presence of `spark` is the switch; `enabled: false` is the soft off (colour and home survive), the
  same shape as `SlotIcon` (A51).
- Colour is one raw CSS colour or theme token, exactly like `Rule.color` and `SlotIcon.glyph`'s
  A23 freedom.
- The spark does not change the slot's reading, its layout or its rules; it only adds a drawing.
- A slot may not chart on its own: the control must resolve and carry history (A63).

## 5. Renderer

- **`TileChart.svelte` (new)** — props `{ series: ChartSeries[], stretch?: boolean }`. One `<svg>`
  with one `<polyline>` per series, `viewBox="0 0 120 28"`, `preserveAspectRatio="none"` in the
  background layer. For each series: `ensureHistory(ioBroker, control.stateId, control.history)`,
  a `noteLive` of the current state when it is newer, then `readHistory`. Points come from a new
  time-mapped builder in `history-ops` (`seriesPoints(series, { from, to, width, height, pad })`),
  `sparklinePoints` staying for the device editor's own previews. Constant series and one-point
  series draw the flat centre line, as today.
- **`Tile.svelte`** — `.tile-bg` keeps its absolute geometry and renders `TileChart` when
  `tileSeries(parts.rows)` is non-empty. The `:global(.spark)` sizing rules and the placeholder CSS go
  (they served one child; `TileChart` sizes itself through `stretch`).
- **`ModalPanel.svelte`** — the non-frame row gains a middle cell between label and control:
  `.row-chart` (`flex: 1; min-width: 0`) holding `TileChart` with one series, `stretch`. The control
  cell stops growing while a chart is present. Frames and rows without charts are untouched.
- Deleted: `slots/SparklineSlot.svelte`, `SlotRenderer`'s import and `sparkline` branch,
  `tileParts`' `background`/`backgroundSlots` path, `sparkline` from `LayoutDetails`' `KIND_GLYPH` and
  `SlotPicker`'s `DEVICE_KINDS`.

## 6. Editor UI

- **Out:** the tile-level chart dropdown (`chartSources`, `currentChart`, `setChart` and the
  "at most one background sparkline" rule) — the chart is now per value, so a tile-level control has
  nothing to say.
- **In:** a **Sparkline** block in the expanded pane of a value slot, next to the Icon block —
  toggle (on → `{ enabled: true }`, off → `{ enabled: false }`, colour and home kept), a colour
  control whose default state is **Auto** (the palette; the same solid-colour control the tile
  background already offers), and the same tri-state `where` cycle the icon block uses (default
  *both*), with the same "a choice that can never render" handling. `patchSpark(tile, index, patch)`
  mirrors `patchIcon`: an emptied descriptor is deleted, never left as `{}`.
- **Disabled with a hint** when the pane resolves no control, or a control without history: *"no
  history for this control — configure it in the device editor"*. Not hidden: an empty block would
  read as a missing feature.
- The collapsed slot row shows a small `show_chart` marker when the slot charts, the way the icon
  preview works.

## 7. Migration and the live document

Five sparkline slots exist, all background charts, none in an unmaterialised tile (the presets carry
none). Verified against the live document:

| tile | chart source | value row it folds onto |
|---|---|---|
| Rooms/Bad thermometer | `temperature` | the temperature value row (modal-only — the chart keeps its own home, A60) |
| Home/Klima thermometer | `temperature` | the temperature value row |
| Garten-Pool Light | `power` | the power value row |
| Wohn-Ess-Z Brunnen | `value` (watts) | none — a modal-only `value` row is inserted (A64) |
| Home/Klima Brunnen | `value` (watts) | none — a modal-only `value` row is inserted (A64) |

The write is applied once through the app's store, read back, and checked in the editor and the
display before the code change is committed. Nothing else in the document changes.

## 8. Testing & verification

- `tile-parts.test.ts` — `hasHistory` (spec *and* stateId); `tileSeries`: slot order, `tile`/`both`/
  `modal` homes, a modal-only row charting the tile (A60), `enabled: false`, control-less and
  dormant rows excluded, palette index stability and `spark.color` override; `rowSpark` for a row.
- `tile-ops.test.ts` — `patchSpark`: set and clear, never leaves `{}`, bad index copies untouched.
- `history-ops.test.ts` — the time-mapped builder: series aligned by timestamp, a shorter series
  occupying the right-hand part, flat and single-point series, empty series, degenerate timestamps.
- Preset integrity test unchanged (no preset charts).
- The editor has no component tests in this repo; it is covered by `svelte-check` and a live
  read-only pass, as A51–A58 were. Gates: `npm test`, `npm run check`, `npm run lint`, `npm run build`.

## 9. Phases

1. Model + resolution (`Slot.spark`, `hasHistory`, `tileSeries`, `rowSpark`, `patchSpark`) with tests.
2. One-off migration of the five live charts (approved write, verified).
3. Renderer (`TileChart`, the tile layer, the modal row) with the sparkline path deleted.
4. Editor (the Sparkline block, the retired chart dropdown, the picker).
5. Retirement of `kind: "sparkline"`, docs (this spec, the A51–A58 spec's cross-reference), handoff.

## 10. Risks

| risk | mitigation |
|---|---|
| per-series min/max makes a nearly-flat series span the full height | today's behaviour; the vertical inset is a one-line constant if the live tiles look wrong |
| a shortest-history series occupies only the right-hand part of the shared x span | documented (A61); the window is per series, the axis is the widest |
| a 1×1 tile with three series looks busy | the `where` cycle turns a value's chart off per home; the palette keeps the lines apart |
| `tileParts` reshuffle touches every renderer consumer | the row lists keep their names and meanings; only their construction moves |
| the two inserted Brunnen rows surprise | they are modal-only, so the tiles look unchanged; both are named in the handoff |

## 11. Non-goals

- A tile legend, colour ticks or labels; axes, tooltips, zoom, or crosshair readout.
- Sparklines on badge, frame, level, colour, enum or button slots.
- Any change to `history-list`, to how history is configured (still per control, in the device
  editor), or to the history store's fetch/debounce behaviour.
- New charts authored into the presets; a chart on an unmaterialised tile.
- A chart mode shared with future features (sample lists, comparisons): the descriptor grows when a
  second mode is actually asked for.
