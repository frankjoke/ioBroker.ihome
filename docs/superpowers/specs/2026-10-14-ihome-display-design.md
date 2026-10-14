# Design — iHome display (basics)

**Date:** 2026-10-14
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Status:** approved design, spec for implementation planning
**Scope:** the *basics* — display route, page/group/device hierarchy, module grid, tiles
and slots, built-in presets, user templates, value-driven rules, and the config editors
needed to author them. Deferred work is listed in "Non-goals".

## 1. Intent

Replace the current iQontrol dashboard as the daily-use UI. The adapter's device JSON is
already the source of truth for devices; today the `/` route is a raw control dump.

Observed on the live iQontrol page (`192.168.178.9:8082/iqontrol`):

- One flat auto-flow grid of icon+text tiles; icon colour/glow by value; tiles with a
  corner arrow embed an inline widget (chart, table, power diagram).
- No page/room/role filtering, and no real responsive strategy — the same fixed tiles
  reflow on a phone.

Success criteria:

1. Page → group → device hierarchy, with group membership filterable by room, function,
   favorite, type, or tags.
2. Tile content, icons, badges and value-driven effects are declared as data, not code —
   with a fixed vocabulary of slot kinds so a template can never ask for a widget that
   does not exist.
3. Device types ship as presets (Switch, Button, Light, Thermostat, Thermometer, Blind,
   Window, Motion, Value, AC, Custom) so a device does not re-declare its own layout.
4. Usable on phone, tablet and desktop from the same config, with a slim top bar so the
   devices get the pixels.
5. Adding a device never breaks a page's layout (no absolute placement anywhere).

## 2. Decisions

| # | Decision |
|---|---|
| A1 | Pages and groups are **explicit config**; a group's contents are either explicit device ids or a filter rule (hybrid). |
| A2 | Size is a **hint** (`w`/`h`, 1–4), clamped per breakpoint — never a pinned coordinate. |
| A3 | Templates are **JSON over a closed slot vocabulary owned by the renderer** (hybrid): the code owns the slot kinds, the template picks/skins/orders them. |
| A4 | Built-in presets are **frozen**; editing means "Save as copy", and new templates can be created from scratch. |
| A5 | Rules attach to **slots**; a control may carry its own default rules; sources resolve control feature → control id → raw state id. |
| A6 | Grow the existing app (single route set, one `www/` build), **display replaces `/`** (Home). |
| A7 | App is branded **iHome**. Adapter identity (`ioBroker.iHome`) is a separate later task. |

## 3. Architecture

Two shells in one SvelteKit SPA:

**Display** — `/` (first configured page) and `/p/[id]`.

- Sticky ~48px bar: small brand, page tabs (from page config, horizontally scrollable),
  filter chips (room / function / favorite), gear → config.
- No page header, no footer; tiles get the viewport.

**Config** — `/devices`, `/pages`, `/templates`, `/settings`, keeping today's shell.
The "Home" tab is dropped from that nav (`/` is the display now).

Page switching is routing (the hash router is already in use), so `#/p/living` is
deep-linkable and back-button-correct; the last page is also persisted so a wall tablet
reboots where it was.

### 3.1 Data flow

```
ioBroker states ──> stores/{devices,pages,templates}.svelte.ts  (parse + migrate)
                          │
        getUsedStateIds() ──┴──> states.svelte.js loadUsedStates()  (subscription set)
                          │
      pageList/templateList + DeviceRegistry
                          │
       pages-ops.resolvePage()  ──> [{ group, devices[] }]
                          │
       template-ops.resolveTemplate(device) ──> Slot[] (merged)
                          │
       rule-ops.resolveStyles(slot, scope, live values) ──> CSS custom props
                          │
                     Tile.svelte ──> SlotRenderer.svelte ──> slots/*.svelte
```

Every step above is a pure function except the stores and the components, so the whole
display can be tested without a broker or a DOM.

### 3.2 Documents

One JSON state per document, following the existing registry pattern
(`registry.svelte.js`: create-if-missing, load on connect, echo-suppressed `onUpdate`,
debounced write, `version` + `migrate*`):

| state id | contents |
|---|---|
| `0_userdata.0.Test.AiHome.deviceList` | existing `DeviceRegistry` |
| `0_userdata.0.Test.AiHome.formulaList` | existing formula library |
| `0_userdata.0.Test.AiHome.pageList` | **new** `PageRegistry { version, updatedAt, seeded?, pages: Page[] }` |
| `0_userdata.0.Test.AiHome.templateList` | **new** `TemplateRegistry { version, updatedAt, templates: Template[] }` (user templates only) |

Built-in presets live in code (`src/lib/config/presets.ts`), frozen; "Save as copy" writes
a user template with `basedOn: <presetId>`.

## 4. Data model

New file `src/lib/types/display.ts`:

```ts
export type Size = { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 | 4 };

export interface Member {              // group contents; every field optional, ANDed
  ids?: string[];                      // explicit device ids
  room?: string;                       // enum.rooms.* id
  function?: string;                   // enum.functions.* id
  favorite?: string;                   // enum.favorites.* id
  type?: DeviceType;
  tags?: string[];
}

export interface Group {
  id: string;
  title?: string;                      // absent → header-less section
  icon?: string;
  member: Member;
  showEmpty?: boolean;
}

export interface Page {
  id: string;
  title: string;
  icon?: string;
  background?: Background;
  groups: Group[];
}

export interface Background { kind: "gradient" | "image" | "solid"; value: string }

export type SlotKind =
  | "icon" | "value" | "level" | "color" | "enum" | "button"
  | "badge" | "sparkline" | "history-list";

export interface Rule {
  when: string;                        // expression, same language as VirtualSpec.expr
  icon?: string;                       // material-symbols name
  color?: string;                      // CSS colour or theme token
  glow?: boolean;
  background?: string;
  hidden?: boolean;
  tone?: string;                       // badge tone: info | ok | warn | danger
}

export interface Slot {
  kind: SlotKind;
  source?: string;                     // control feature → control id → state id
  label?: string;
  unit?: string;                       // overrides the control's unit when set
  options?: Record<string, unknown>;   // per-kind knobs (min/max/step/decimals/…)
  rules?: Rule[];
}

export interface Template {
  id: string;
  name: string;
  builtin?: boolean;
  basedOn?: string;                    // preset id this was copied from
  type: DeviceType;
  size?: Size;
  features: FeatureDef[];              // reuses features.ts FeatureDef (+ required?)
  slots: Slot[];
}
```

`FeatureDef` (`src/lib/config/features.ts`) is reused rather than duplicated: it already
holds `feature` / `label` / `widget` / `roleHints` per device type, and the device form's
suggestion logic reads it. It gains one optional field, `required?: boolean`, so a template
can insist that "a Thermostat must have a setpoint".

`Device` gains, all optional (additive — existing registries keep working):

```ts
functions?: string[];   // enum.functions.* ids
favorites?: string[];   // enum.favorites.* ids
tags?: string[];
template?: string;      // preset id or user template id
size?: Size;
slots?: Slot[];         // device-level override/addition
watch?: string[];       // raw state ids referenced by rules/expressions
```

`Control` gains `rules?: Rule[]`.

### 4.1 Model rules

1. **Merge order:** preset → `device.template` → device `slots` → control-level `rules`.
   Slots merge by `(kind, source)` identity (later wins); rules concatenate and evaluate
   top-to-bottom, last match wins.
2. **Source resolution:** control `feature` → control `id` → raw state id
   (`get("<stateId>")`, which the formula engine already supports).
3. **Group membership:** groups with explicit `ids` are claimed **first**; then filter
   groups in order. A device claimed earlier is excluded later — no duplicate tiles, and
   pinning a device wins over any filter.
4. **Empty devices:** a device with no visible/available controls renders only when the
   group sets `showEmpty`.
5. `Device.section` / `panel` are dead half-fields: left in place, **not** used by the new
   hierarchy (groups replace that idea), marked deprecated in a comment.
6. **Explicit, not derived:** filtering tests `Device.room` / `functions` / `favorites` /
   `type` / `tags` — the fields on the device — never the enum reverse index. The device
   form pre-fills `room` (as it already does) and *suggests* functions/favorites from the
   controls' enum membership at add time, but what is stored is what filters. This keeps
   filtering deterministic and immune to the messy derived taxonomy (§9).

### 4.2 Presets

`src/lib/config/presets.ts` ships one frozen template per `DeviceType`, built on
`DEVICE_FEATURES[type]` plus the slots that make the type recognisable:

| preset | size | slots (beyond icon + name) |
|---|---|---|
| Switch | 1x1 | value (state text), badge: ago/offline |
| Button | 1x1 | button |
| Light | 1x1 | level (brightness), color, value, badge: ago/offline; icon rules for on/off colour + glow |
| Thermostat | 2x1 | value (actual), level (setpoint), enum (mode), badge: ago/offline |
| Thermometer | 1x1 | value (temp), value (humidity), badge: ago/offline/battery |
| Blind | 2x1 | level (position), button (stop) |
| Window | 1x1 | value (open/closed) |
| Motion | 1x1 | value (last motion + ago) |
| AC | 2x2 | switch, enum (mode), level (temperature), level (fan) |
| Value | 1x1 | value, badge: ago/offline |
| Custom | 1x1 | value, switch, level |

Derived readings need no sensor: dew point and room health (as in the Thermometer brief) are
**virtual controls** on the device, reusing the existing `VirtualSpec` expression engine and
formula templates — so they arrive as ordinary controls and need no new machinery here.

## 5. Layout

One CSS grid per group: `grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr))`,
`grid-auto-rows: var(--tile-min)` (square modules). A tile spans
`min(w, var(--max-w))` columns and `min(h, var(--max-h))` rows:

| breakpoint | `--tile-min` | `--max-w` | `--max-h` |
|---|---|---|---|
| phone `<600px` | 150px | 1 | 2 |
| tablet `600–1024px` | 170px | 2 | 2 |
| desktop `>1024px` | 190px | 4 | 4 |

So `2x2` degrades to `1x2` on a phone, `4x2` to `2x2` on a tablet, and hints are honoured
as written on desktop. No absolute placement exists anywhere, so a new device can only
append.

Groups render as sections: quiet header (`title`, count, collapse toggle) when `title` is
set, header-less (continuous rows) when it is not. Page-level background only — no per-group
backgrounds.

## 6. Renderer

- `Tile.svelte` resolves device → preset → template → overrides → `Slot[]`, then renders
  each slot through a closed `SlotRenderer.svelte` switch.
- Slot kinds, and what each renders:

| kind | renders | reuses |
|---|---|---|
| `icon` | material symbol, colour/glow by rules | — |
| `value` | formatted number/text + unit | `formatValue` |
| `level` | range slider (writable) | existing level widget |
| `color` | colour picker (writable) | existing colour widget |
| `enum` | select from `common.states` | existing enum widget |
| `button` | press (writes `true`) | existing button widget |
| `badge` | compact icon + tone | — |
| `sparkline` | inline SVG from the history store | `HistorySummary`/`sparklinePoints` |
| `history-list` | short last-N list | history store |

- **Effects** are computed once per device into CSS custom properties
  (`--tile-accent`, `--tile-glow`) and styling hangs off those — `glow` is one shared rule,
  a **static box-shadow with no pulse animation**, disabled under `prefers-reduced-motion`.
- **Badges** collapse to a compact row (3 visible + `+n`). Sources are declared controls
  (`battery`, `error`) plus two the renderer derives without any control: `ago` (newest
  `ts` across state-backed controls) and `offline` (`available`/`exists` false). Unavailable
  devices still render, carrying the `offline` badge, so a dead sensor stays visible.
- The modal reuses the existing control widgets (`ControlRow`).

## 7. Interaction

- Tile body tap: toggle for `switch` sources, otherwise open the modal.
- Corner affordance (⤢) and long-press open the **modal** with the full control set —
  focus-trapped, Esc closes, sliders `stopPropagation` so dragging never opens it.
- Filter chips are ephemeral view state, persisted to `localStorage` (like the last opened
  page and each group's collapsed flag) — never to config. They filter within the current
  page and show a match count. A group that filters down to nothing is hidden unless it
  sets `showEmpty`.

## 8. Editing

- `/devices` (existing form) gains: template, size, functions, favorites, tags, `watch`,
  and a per-control rules editor. Devices whose controls do not satisfy a template's
  `required` features are flagged in the device list — a template never fails silently.
- `/pages`: list + editor — page fields (title, icon, background picker) and a reorderable
  group list; each group's member builder reuses the existing `MultiSelect` plus room /
  function / favorite pickers.
- `/templates`: preset library rendered read-only, with **New from preset** and
  **Save as copy**; the editor edits slots (add/remove/reorder kind, source picker, rules
  with a `when` expression input plus icon/colour/glow pickers) and shows a **live preview
  tile bound to a real device of that type**.

Editors are deliberately plain forms in this phase (no drag-and-drop canvas, no rule
builder wizard) — the data model is what has to be right first.

## 9. Migration & seeding

- `pageList` absent on first load → seed once, marked `seeded: true`: one "Home" page with
  one group per **function** (the broker's functions are sane: `Heizung`, `Klima`, `Licht`)
  plus a "Rooms" page with one group per room as **explicit ids** — the messy derived state
  (22 rooms incl. `Vorzimmer`/`vorraum` duplicates and unresolved `upstairs`/`basement`
  names) is a starting point to rename and merge, not a permanent constraint.
- `templateList` absent → empty list; presets come from code.
- Existing registries are untouched: new `Device` fields are optional and
  `migrateRegistry` keeps working.

## 10. Error handling

- Unparsable registry state → keep current in-memory model, ignore the write, log; never
  wipe user config.
- Unknown template id on a device → fall back to the preset for `device.type`.
- Unresolvable slot source → skip that slot's rendering and flag the device as incomplete
  in the config UI (not a crash, not a blank tile).
- Unavailable/nonexistent state → tile renders with the `offline` badge.
- Expression errors (`evaluateVirtual` already never throws) → the rule simply does not
  match; surface the message in the config editor only.

## 11. New/changed files

Add:

- `src/lib/types/display.ts`
- `src/lib/config/pages-ops.ts` (+ `.test.ts`)
- `src/lib/config/template-ops.ts` (+ `.test.ts`)
- `src/lib/config/rule-ops.ts` (+ `.test.ts`)
- `src/lib/config/size-ops.ts` (+ `.test.ts`)
- `src/lib/config/presets.ts`
- `src/lib/stores/pages.svelte.ts`, `src/lib/stores/templates.svelte.ts`
- `src/lib/components/display/{PageView,GroupSection,Tile,SlotRenderer,FilterChips,TileModal}.svelte`
- `src/lib/components/display/slots/*.svelte`
- `src/lib/components/config/{PageEditor,GroupEditor,TemplateEditor,TemplateList,RuleEditor}.svelte`
- `src/routes/p/[id]/+page.svelte`, `src/routes/pages/+page.svelte`, `src/routes/templates/+page.svelte`

Change:

- `src/routes/+page.svelte` — display, replacing the Home control dump.
- `src/lib/types/device.ts` — new `Device` fields, `Control.rules`.
- `src/lib/config/project.ts` — persist the new fields.
- `src/lib/config/rooms.ts` — generic `enumsOf(enums, id, type)` + `functionsOf` / `favoritesOf`
  (`EnumMap` already indexes any enum type, including `favorites`).
- `src/lib/stores/devices.svelte.ts` — `getUsedStateIds()` also unions
  `device.watch` and state ids referenced by rules.
- `src/lib/pages.js`, `src/routes/+layout.svelte` — nav list, iHome branding.

## 12. Testing & verification

Unit tests (vitest, node env, `requireAssertions: true`; no DOM/component tests, matching
the repo's existing style) for the pure modules:

- `pages-ops` — explicit-first, first-match-wins, ANDed filters, tags, empty handling.
- `template-ops` — merge order, `(kind, source)` override, preset fallback by type.
- `rule-ops` — last-match-wins, `hidden`, tone mapping, expression error → no match.
- `size-ops` — the breakpoint clamp table above.
- `rooms.ts` — `enumsOf` for `functions`/`favorites`, `enumShortId`.

Non-trivial logic leaves this check behind: `pages-ops` and `rule-ops` are the two that
would silently ship wrong tiles.

Verification per phase: `npm test`, `npm run check`, `npm run lint`, `npm run build`
(writes `www/`), plus a browser smoke pass at phone/tablet/desktop widths against the
already-running dev server.

## 13. Phases

**This spec's implementation plan covers phases 1–3** — the display's data model, layout and
rendering: the "basics of the UI". Phases 4–5 (the authoring editors and first-run seeding)
get their own plan, because until the renderer exists there is nothing for an editor to
preview, and the presets can carry the first weeks of use on their own.

1. **Model + pure ops + tests** — `display.ts` types, `pages-ops`, `template-ops`,
   `rule-ops`, `size-ops`, `presets.ts`, `enumsOf`. No UI yet.
2. **Display basics** — routes, `PageView`/`GroupSection`/`Tile`/`SlotRenderer`, module grid
   and clamping, presets only (no rules).
3. **Rules, effects, badges** — rule evaluation into CSS custom props, implicit `ago` /
   `offline` badges, `TileModal`, filter chips.
4. **Editors** — `/pages`, `/templates`, device form additions (template, size, functions,
   favorites, tags, watch, control rules).
5. **Seeding + kiosk polish** — first-run seed, last-page persistence, `prefers-reduced-motion`,
   page backgrounds.

## 14. Risks

- **HMR module duplication.** The history store already got bitten by module-global client
  injection (recorded in the 2026-10-13 handoff): two `?t=` module instances meant two
  clients and a permanently empty cache. New stores must import the shared `ioBroker` and
  take the client as an argument — no `setClient()` globals.
- **Bundle size on phones.** The display and the config editors ship in one bundle; the
  device page and its heavy pickers should stay lazily reachable so the display route stays
  cheap.
- **`new Function` in rules.** Same trust level as the existing virtual formulas
  (locally authored config, no remote input) — no new exposure, but worth stating.
- **`watch` semantics.** Adding it fixes a real existing hole (a virtual formula's
  `get("<stateId>")` silently returns `undefined` unless the state happens to be subscribed).
  The subscription pass must union `watch` ids, or rules on raw states silently never match.

## 15. Non-goals

Charting engine · drag-and-drop layout · per-group backgrounds · absolute placement ·
vis-2 export · adapter rename/publish · remote push · animations beyond a static glow ·
partial-failure recovery beyond the handling in §10.
