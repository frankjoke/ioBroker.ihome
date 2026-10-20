# Handoff — 2026-10-20 — the icon slot retires (A56)

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`. Retirement commit `9d58876` on top of `e3a6a33`. |
| **Spec** | `docs/superpowers/specs/2026-10-19-ihome-slot-icons-design.md` — A52/A56 amended, retirement marked done. |
| **Live document** | `0_userdata.0.Test.AiHome.pageList` folded once, `updatedAt` 1792527597469; **0** `kind:"icon"` slots in all four states. |
| **Dev server** | The user's runs on :5173 (Host:Port `192.168.178.9:8081`, Namespace `0_userdata.0.Test.AiHome`). |

## The one-off fold (before the code changed)

Seven tiles still carried an icon slot. They were folded through the app's own
store (`commitLayout`), not by hand-editing the state:

- Five via `foldIconSlot`: Bew., Garten-Pool Light, Keller Light, Wohn-Ess-Z
  Brunnen, Home/Klima Brunnen — target their `power`/`motion` value slot.
- **Two needed a manual target**: Bad.Thermometer and Home/Klima Thermometer had
  their only same-source slot on the **background sparkline**, which never draws
  an icon. They were moved onto the first **tile-visible value** slot instead
  (Bad: humidity; Home: temperature), so the glyph did not disappear.
- Rules moved with the glyphs (colour/glow preserved). No `where` was invented.
- `updatedAt` was bumped separately because the one-off bypassed the layout ops.

## The retirement (`9d58876`)

- `SlotKind` no longer has `"icon"`; `IconSlot.svelte`, the renderer branch, the
  accent fallback in `Tile`, `iconSlotTarget`/`foldIconSlot`, the A36
  icon-consumption exception and every editor affordance (legacy badge, fold
  confirm, icon kind option, rules copy) are gone.
- `headlineSlot` = first value, else first slot. The tile accent is simply the
  headline's style.
- **No load-time migration by design.** A document that still carried an icon
  slot would render nothing; the live document carries none (A56 records this).
- Tests that pinned the legacy path were deleted; fixtures that used `icon` as
  an arbitrary kind now use `value`/`badge`.

## Checks

- `npm test` — 356 passing, 30 files. `npm run check` — 0/0. `npm run lint` — 0.
  `npm run build` — green. (The `devices.svelte.ts` state-reference warning is
  pre-existing.)
- Live, read-only: Rooms shows 8 glyphs in their clusters (`device_thermostat`,
  `power_settings_new`, `lightbulb_outline`, `directions_walk`); the Home/Klima
  tile's detail header carries the headline glyph and the humidity row reads
  normally; the editor shows six rows (sparkline, value “headline”, value,
  badges), no `legacy`, no fold button, no `icon` option.
- Console: only the third-party `energiefluss` path error and the known
  `templateList` warning.

## Small follow-up

The tile editor's **Edit this device** button wore `tune` — the same glyph as the
Page/Section settings buttons, so it read as another UI-editing action. It wears
`edit` (pencil) now; the `arrow_back` state is unchanged. Live-verified.

## Open items

- **The icon `where` cycle still offers homes that can never render** (the
  humidity tile found it). Hardening offered, still awaiting your word.
- **Wide (w ≥ 2) beside-layout** was not observable read-only; the un-stacked
  default is the mechanism.
- The size constants (tile headline 34 / secondary 17 / header 26 / rows 18)
  remain one-line tunables.
- Your interactive checklist is down to: Reset a materialised tile to see the
  preset look, flip a headline icon off/on, and set an icon detail-only. The
  legacy-fold step (old item 5) no longer exists.
