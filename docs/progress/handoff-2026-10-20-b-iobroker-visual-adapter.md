# Handoff — 2026-10-20 (b) — the slot sparklines (A59–A64)

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`. Retirements `9d58876` (icon slot) then the sparkline slice `074c6d4`, `e37d75b`, `fe5930a`. |
| **Spec** | `docs/superpowers/specs/2026-10-20-ihome-slot-sparklines-design.md` (A59–A64). Plan: `docs/superpowers/plans/2026-10-20-ihome-slot-sparklines.md`. |
| **Live document** | `0_userdata.0.Test.AiHome.pageList`, `updatedAt` 1792530663703: **3** `spark` descriptors, **0** `kind:"sparkline"`, no other slot changed. |
| **Dev server** | The user's on :5173 (Host `192.168.178.9:8081`, namespace `0_userdata.0.Test.AiHome`). **Vite's watcher lagged on this OneDrive path** during the session: several pages served a stale module until the file was `touch`ed. If something looks impossible, `touch` the file and reload hard. |

## What the sparklines are (A59–A64)

The chart stopped being a slot of its own and became **a property of the value slot it describes**:

- `Slot.spark = { enabled?, where?, color? }` on **value** slots only. `enabled: false` keeps colour and home but draws nothing. `where` (tile / both / modal, absent = both) is the chart's **own** home, deliberately **not** narrowed by the slot's `where` and not gated by the row's visibility (A60, the opposite of the icon) — a value that only shows in the detail can still feed the tile's chart.
- **Tile (A61):** the existing chart layer now draws **every** value that charts there, in slot order, each series in its own colour — the palette (`--primary-color`, `--success-color`, `--warning-color`, `--danger-color`, `--secondary-color`) by the slot's index among the tile's chart-enabled values, or the slot's own `spark.color`. y is per series (its own min/max), x is **time** across the widest window. No legend, no placeholder, no reserved space.
- **Detail (A62):** a value row reads **label → chart → value**; the value stops taking the growing column while its chart is present. The row chart is row content, so it follows the row's visibility.
- **A control charts only when it has history** (`history` spec + `stateId`); the editor's Sparkline block is disabled with a hint pointing at the device editor otherwise. `history-list` is untouched (A63).
- Editor: a **Sparkline** block beside the **Icon** block (toggle, colour select with an Auto state, the tri-state home cycle), a `show_chart` marker on the collapsed row, and the tile-level **History chart** dropdown is gone. `kind: "sparkline"` no longer exists; the `+` picker offers no chart slot.

## The migration, and what it taught us

The five live charts were folded one-off before the code changed (A64):

| tile | chart | outcome |
|---|---|---|
| Rooms/Bad thermometer | temperature | folded onto the temperature value row |
| Home/Klima thermometer | temperature | folded onto its `pick: temperature` value row |
| Home/Umwelt | value (Temperatur) | folded onto its `pick: temperature` value row |
| Wohn-Ess-Z Brunnen | watts | **reverted** — see below |
| Home/Klima Brunnen | watts | **reverted** — see below |

Two lessons, both ledgered:

- **Resolve with the chart slot excluded.** With the dormant chart slot still in the list, `pickSlotControls`' used-set let it claim the control first, so a `pick`-based value row looked carrier-less and would have got a duplicate inserted row.
- **The two Brunnen "orphan" charts were already dead.** No Brunnen control has history (`deviceList`), so their old sparkline slots drew nothing either. Inserting a modal-only watts row would have invented a chart-less row in the detail page, so those two insertions were reverted: those tiles render exactly as before. To revive them, configure history for `alias.0.WZ.Brunnen.ELECTRIC_POWER` in the device editor and enable the Sparkline toggle on a value row.

## Checks

- `npm test` — 367 passing, 30 files. `npm run check` — 0/0. `npm run lint` — 0. `npm run build` — green. (The `devices.svelte.ts` state-reference warning is pre-existing.)
- Live: tile charts draw in palette colour (`rgb(73,75,214)` for the first series); a charted row shows one polyline with `where: both` and none with `where: tile`; the editor shows the Sparkline block, the disabled hint on humidity/Taupunkt, no History-chart field, and a picker without `sparkline`.
- New tests: `seriesPoints` (shared window, clamping, flat/single, degenerate), `hasHistory`/`tileSeries`/`rowSpark` (home, soft off, palette index, no control), `patchSpark`.

## Open items

- **Only three values chart** on the live document; the Brunnen tiles wait on history for their watts control (above).
- The icon `where` cycle still offers homes that can never render (carried over, awaiting your word).
- Wide (w ≥ 2) beside-layout and the size constants (headline 34 / secondary 17 / header 26 / rows 18) remain one-line tunables.
- Non-goals, still out: legend/colour ticks, sparks on badge/frame/level/color/enum/button, a chart mode shared with `history-list`, preset-authored charts, axes/tooltips/zoom.
