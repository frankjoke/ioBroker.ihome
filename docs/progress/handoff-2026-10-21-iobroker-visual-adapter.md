# Handoff — 2026-10-21 — device icons from the broker hierarchy (A65–A69)

## Where things are

| | |
|---|---|
| **Main checkout** | `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`, branch `feature/ihome-display`. Slice `696fd0e` (icon-ops + `iconSrc`), `97f788f` (Icon as the one renderer), `62db65d` (device enrichment), `664b445` (the four places). |
| **Spec** | `docs/superpowers/specs/2026-10-21-ihome-device-icons-design.md` (A65–A69). Plan: `docs/superpowers/plans/2026-10-21-ihome-device-icons.md`. |
| **Live document** | untouched by this slice (no document field changed). |
| **Dev server** | The user's on :5173 (Host `192.168.178.9:8081`, namespace `0_userdata.0.Test.AiHome`). The OneDrive watcher still lags: `touch` a file and reload hard when something looks stale. |

## What landed

- **`icon-ops.ts`** (pure): `ownerOf`, `objectIconValue` (`modelIcon` → `extIcon` → `icon` **on that
  object**), `resolveIcon` (walk the id's parents, then `system.adapter.<adapter>.<instance>`, then
  `system.adapter.<adapter>`), `deviceObjectIcon` (the first control that resolves).
- **`iconSrc` replaces `iconUrl`** (A66): `data:`/`http(s)`/`//` pass through; a symbol name is left
  alone; a leading `/` is broker-root-relative **for a broker value** and stays app-relative for a
  document value; `adapter/…` and bare filenames get the ioBroker base
  (`http(s)://<hostPort>` from the footer, else this origin), a bare filename under
  `/adapter/<adapter>/` where the adapter is the owning object's first id segment.
- **`Icon` is the single image renderer** — `EnumBadge` and `MultiSelect` dropped their own `isUrl`
  (which treated `energiefluss.png` as a symbol and resolved paths against the app's origin).
- **`EnrichedDevice.objectIcon`** = the document's `icon` when set, else the resolved broker icon,
  already a URL. **Only the device's face** uses it (A65): the tile's name line, the detail header
  when the headline slot has no icon, the devices page rows, the sheet's device picker.

## Live evidence

Resolution over the 12 live devices (through `getDevicesEnriched`): **Bad.Thermometer** → the channel
`alias.0.1Stock.TemperaturBad`'s inline SVG (1566 B); **3D-Printer** and **BambuPrinter** →
`system.adapter.bambulab.0`'s GitHub `extIcon`; **Switch** → `system.adapter.mcp.0`'s; the other
**eight** resolve nothing (no icon anywhere up to `alias.0`, and no `system.adapter.alias*` object
exists on the broker) and render exactly as before.

Rendered: three tiles show an icon at the name (Bad 46×46 inline, both printers 300×300), and four of
twelve devices-page rows (all loaded). URL forms verified against the broker:
`/adapter/energiefluss/energiefluss.png`, `/adapter/alexa2/icons/echo_dot.png`,
`/adapter/admin/admin.svg` all load; `energiefluss.png` at the broker root does **not** (the
`/adapter/<adapter>/` form is the right one).

## Not observed live

- The sheet's **device picker** rows (no reachable trigger from a script) and the **detail-header
  fallback** (no live device has a headline slot without an icon — the presets always set one). Both
  are the same three lines as the verified places; worth a glance when you next open the sheet.

## Limits (A69)

- A relative icon on an object with no owning adapter (`enum.*`) is tried at `/adapter/<segment>/…`
  and may 404; the live enum icons are `data:`, which pass through.
- A 404 renders nothing (no placeholder), as before.
- The picker's **Broker** tab still lists `common.icon` values only — it does not gain
  `modelIcon`/`extIcon` entries; the automatic device fallback is what reads those.
- A native `<select>` cannot show images: the tile pane's device dropdown stays text-only.

## Open items

- **Backlog — state-dependent icons** (an icon that follows active/inactive beyond a rule's `icon`).
- The icon `where` cycle still offers homes that can never render.
- The Brunnen tiles' charts wait on history for `alias.0.WZ.Brunnen.ELECTRIC_POWER`.
- Five deferred review minors from the sparkline slice (Auto colour can clear a bare descriptor; a
  spark whose control lost history can't be cleared from the pane; `TileChart`'s dead default sizing;
  the older 2026-10-14/16 specs still describe `options.background`; a legacy registry would render an
  empty row).
