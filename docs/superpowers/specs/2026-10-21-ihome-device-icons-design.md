# Design — iHome device icons from the broker hierarchy

**Date:** 2026-10-21 · **Status:** proposed — awaiting review before the plan.
**Depends on:** `2026-10-19-ihome-slot-icons-design.md` (A23 raw icon strings, A51 the slot icon),
`2026-10-14-ihome-display-design.md` (the device registry), `2026-10-16-ihome-tile-editor-design.md`.
**Scope:** a device's own face falls back to the icon its ioBroker objects carry, resolved up the
object hierarchy; every icon URL is resolved against the ioBroker host; `Icon` becomes the single
image renderer. Value slots keep exactly the icons they are configured with.

## 1. Intent

A slot's icon is a document value today, and the only handling of an image path is
`iconUrl()` — which turns anything non-absolute into `/value` on the **app's** origin. On the dev
server that is `localhost:5173/…`, so every broker-relative icon 404s: 253 of your objects carry a
relative filename (`energiefluss.png`, `icons/echo_dot.png`, `admin.svg`). `extIcon` and `modelIcon`
are never read at all.

Meanwhile the devices show no icon of their own, although the broker knows one: your
`alias.0.1Stock.TemperaturBad.ACTUAL` has none, its **channel** carries a 1.5 kB inline SVG, and
`system.adapter.bambulab.0` carries an `extIcon`. So:

- a device resolves its icon through the object hierarchy (the long-standing approach in this
  household's ioBroker work), and shows it wherever a device presents itself;
- an icon value renders correctly whether it is inline, external or a broker filename.

## 2. Decisions

| # | Decision |
|---|---|
| A65 | **The device icon comes from the broker hierarchy.** The document's `Device.icon` wins when set (no device on the live document has one). Otherwise the device's controls are walked **in control order**: for each, its `stateId` is walked upward (`a.b.c.d` → `a.b.c` → `a.b` → `a`) and the **first object that carries any of `modelIcon`, `extIcon`, `icon` — tried in that order on that object** — wins (nearest object first: a channel's inline SVG beats an `extIcon` further up). With nothing found, the adapter: `system.adapter.<adapter>.<instance>` then `system.adapter.<adapter>`, where `<adapter>.<instance>` are the first two segments of the originating id — **per control**: the first control that needs the fallback uses its own adapter, not the device's. Nothing found → no icon, and the device renders as it does today. Resolved once, in the device enrichment, as `EnrichedDevice.objectIcon` (see A68); **only the device's face uses it — a value slot renders exactly the icon it is configured with, and a slot with no icon gets none** (the A51 block, `enabled: false` included). |
| A66 | **Icon URLs are resolved against the ioBroker base.** New `iconSrc(raw, owner?)` replaces the `/`-prefixing `iconUrl`: `data:`, `http(s)://` and protocol-relative values pass through; a leading `/` is **ioBroker-root-relative** — rebased onto the base for a value taken from a broker object, left alone for a value typed into the document; `adapter/…` → `<base>/adapter/…`; a bare filename → `<base>/adapter/<owner>/<file>` when the owner (adapter) is known, else `<base>/<file>`. The base is `http(s)://<hostPort>` from the footer setting (the same value the socket URL uses), falling back to `location.origin` — in production the app is served from `/adapter/ihome/…`, where root-relative already means the broker. `Icon.svelte` becomes the single image renderer: `EnumBadge.svelte` and `MultiSelect.svelte` drop their hand-rolled `isUrl` — which treats a bare filename like `energiefluss.png` as a symbol name (so it is invisible) and resolves anything path-like against the app's origin (so the room/function badges 404 on the same values). Symbol names stay symbols (`isImageIcon`, A23). **What the picker stores:** picking from the Broker tab writes `brokerIconPath(value, ownerId)` — the portable `adapter/<adapter>/<file>` form — so the icon keeps rendering after a host change and resolves without an owner; the previews in that tab render with the owner, `Icon value={entry.value} owner={entry.id}`. **A 404 renders nothing:** the renderer drops an image whose load failed rather than showing a broken-image glyph. |
| A67 | **Where the device icon shows:** the tile's **name line** (before the text), the detail page's **header** (only when the headline slot carries no icon of its own — a slot icon always wins, A54 unchanged), every **device row in the devices page**, and the icon-capable pickers — the sheet's device picker and the devices filter. A native `<select>` cannot show images, so the tile pane's device dropdown stays text-only (a documented limit, not a bug). |
| A68 | **Resolution is cheap and happens once.** The walk is a handful of `Map` lookups per control, run inside the existing device enrichment (recomputed when the device list or the object cache changes) — no network, no per-render walk, no new cache. `objectIcon` is stored **already resolved to a URL** (the base applied when it is built), so components render it as an opaque string. |
| A69 | **Limits, stated.** A relative value on an object with no adapter to own it (`enum.*`, `0_userdata.*`) is tried at `/adapter/<first-segment>/…` and may 404 — the live layout's enum icons are `data:`, which pass through; an icon that 404s renders nothing (A66: a failed image is dropped, not a broken glyph); the picker's Broker tab keeps listing `common.icon` values (it does not gain `modelIcon`/`extIcon` entries — the automatic device fallback is what uses those); nothing is written into the document by this change. |

## 3. Architecture

```
ioBroker.objects (already loaded, 10 332 entries)
        │
icon-ops.ts (pure, tested):
        ├─ ownerOf(id)                      → { adapter, instance }
        ├─ pickObjectIcon(object)           → modelIcon → extIcon → icon on that object
        ├─ resolveIcon(objects, stateId)    → walk up, then the adapter, then undefined
        └─ iconSrc(raw, owner?)             → the URL on the ioBroker base
        │
devices enrichment (stores/devices.svelte.ts)
        └─ EnrichedDevice.objectIcon = device.icon ?? resolveIcon(objects, first control's stateId)
        │
Icon.svelte (the only image renderer) ── tile name, detail header, devices page, pickers
                                     └─ EnumBadge / MultiSelect (badge + filter icons)
```

## 4. Data model

```ts
// types/device.ts
export interface EnrichedDevice extends Device {
  /* …unchanged… */
  /** The device's icon from the broker hierarchy (A65), already a URL (A68).
   *  Absent when the broker knows none. `Device.icon` (document) still wins. */
  objectIcon?: string;
}
```
No document field is added or changed; `Device.icon` stays as it is.

### 4.1 Model rules

- `objectIcon` is presentation only: it never enters the page/template documents, so an adapter's
  icon update shows up without touching a document.
- A slot's icon (A51) is untouched — presence, `enabled`, `where` and the rules' icons behave
  exactly as they do today; the device icon is a separate, coarser face.
- The device icon never replaces the tile's *reading*; it only precedes the name.

## 5. Renderer & UI

- `Icon.svelte` takes an optional `owner` (the adapter id a broker value came from) and renders
  `iconSrc(value, owner)`; everything else stays as it is (size, `dim`, `object-fit`).
- `Tile.svelte`: the `.tile-name` line gains an `<Icon>` before the text when the device has one.
- `ModalPanel.svelte`: the header's `headIcon` falls back to the device icon when the headline slot
  has no icon (the existing `rowIcon` logic and its A54 rule are unchanged).
- `routes/devices/+page.svelte`: each device row shows its icon before the name.
- `DevicePicker.svelte` (the sheet) and the devices filter (`MultiSelect`) show the device icon in
  their options through the same `Icon`.
- `EnumBadge.svelte` / `MultiSelect.svelte`: their `isUrl` helpers are deleted in favour of `Icon`.

## 6. Testing & verification

- `icon-ops.test.ts` — `ownerOf` (`alias.0.1Stock.X`, `system.adapter.x.0`, `system.adapter.x`,
  `enum.rooms.Bad`); `resolveIcon` per-object field order (`modelIcon` on the child beats `icon` on
  the parent; `icon` on the child beats `extIcon` on the adapter), the adapter fallback, the
  instance-then-package order, and "nothing found";
  `iconSrc` for `data:`, `http(s)`, `//`, `/root`, `adapter/x/y.png`, a bare filename with and
  without an owner, and with and without a configured `hostPort`.
- `devices.svelte.ts` / projection test: the enrichment sets `objectIcon` from the first control that
  resolves, and leaves it unset when nothing resolves.
- Live: `Bad.Thermometer` shows the channel's inline SVG on the tile name, in its detail header, and
  in the devices page; `3D-Printer` shows the bambulab `extIcon`; a device with nothing keeps its
  current look; the picker's Broker tab renders its relative-filename entries.
- Gates as usual: `npm test`, `npm run check`, `npm run lint`, `npm run build`.

## 7. Phases

1. `icon-ops.ts` (ownerOf, pickObjectIcon, resolveIcon, iconSrc) with tests.
2. `Icon` on `iconSrc`; `EnumBadge`/`MultiSelect` routed through it — the URL fix, verifiable on its
   own (the picker's Broker tab starts rendering).
3. The device enrichment carries `objectIcon`.
4. The four places render it (tile name, detail header, devices page, pickers).
5. Docs: this spec, the handoff.

## 8. Risks

| risk | mitigation |
|---|---|
| an external `extIcon` (GitHub) disappears if the vendor moves it | nothing else to fall back to by design; the document icon still wins |
| the ioBroker base is unset (empty footer field) and the app runs on another origin | falls back to `location.origin`, which is correct in production and 404s in dev — the app already needs the footer set to talk to the broker at all |
| a tile now shows two icons (device icon at the name, slot icon at the value) | they mean different things and the sizes differ; the device icon is at the name's size, not the headline's |
| `EnumBadge`'s fix changes room badges that were showing nothing | that is the bug being fixed; the badge keeps its label either way |
| walking parents misses icons stored on a *grandparent* type we do not know | the walk is generic on the id path; only the adapter step needs the id's first two segments |

## 9. Non-goals

- Automatic icons for value slots (A65): slots keep what they are configured with.
- A per-control or per-channel icon picker section; the picker's Broker tab keeps its current list.
- Writing resolved icons into the documents (that would freeze the adapter's icon).
- `getObjectView`/enum icon resolution for rooms and functions beyond the shared renderer fix.
- Retrying a 404 against other candidate paths, or a placeholder for a missing icon.
