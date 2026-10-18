# Design — iHome tile editor (P2: tiles, slots, rules, templates)

**Date:** 2026-10-16
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Status:** approved design, spec for implementation planning
**Depends on:** `2026-10-14-ihome-display-design.md` (A1–A7, the renderer and slot vocabulary),
`2026-10-15-ihome-layout-editor-design.md` (A8–A17, the tree and the placement model)
**Scope:** the *second* slice of real configuration — edit a placement's own tile (general options,
slots, rules), author and apply per-type templates from a tile, pick icons and backgrounds for pages
and sections, and route from the display into the editor focused on one page or section. Tile
enlargement is built as the slots' own `where` (A34); cross-device slots (`from`) stay deferred
(S2). Deferred work is listed in "Non-goals".

## 1. Intent

P1 made the page → section → tile tree editable; a tile itself still renders only its device's
defaults (device → template → preset) and every visual iteration — "show the wattage", "this one
should glow red when the pump runs", "give the light tile the same layout" — needs a code change or a
hand-edited document. Three concrete problems:

1. There is no way to add a value to a tile, bind it to a control, a placeholder, or an arbitrary
   state, or attach a condition to it.
2. Templates exist in the model (`templateList`) and in the resolution chain, but the document is
   still `null` and nothing can author or apply one.
3. Page and section appearance is half-editable (background has no UI, icons are free text), and the
   display's section header offers no route into the editor — the pencil lands in the tree with
   everything to find by hand.
4. A tile has no notion of "currently active": the Brunnen's wattage badge, or an icon that changes
   while the pump runs, can only be shown always or through hand-written per-slot expressions.

Success criteria:

1. From the running app: `+` on a tile row (or in the pane) adds a slot bound to one of the tile's
   device controls, a **placeholder** (`temperature`, or any free text matched by role → label →
   unit), or **any state id** (read-only); the tile preview and the display show it live.
2. A slot's rules (`when` expression, icon, colour, glow, background, hidden, only, disabled, tone) are
   editable per slot, in order.
3. A tile can be saved as a **per-type template** (size, slots, CSS background) and applied to
   another tile; a template's placeholder slots stay dormant until they resolve — at bind time in the
   editor or later, when the device gains a matching control.
4. The first edit **materialises** the tile (device → template → preset, frozen); afterwards it
   diverges independently, and **Reset** returns it to the chain.
5. Page and section backgrounds are edited with a colour picker and a gradient builder; icons come
   from a picker (material symbols, the document's own icons, the broker's `common.icon` images, a
   URL) and can be images wherever an icon shows.
6. Ctrl/Cmd+click a section header on the display opens the editor with **only that section
   unfolded** — its tiles listed directly; the same for a page tab.
7. The live document keeps working: unmaterialised and legacy partial tiles render exactly as today;
   `templateList` is written only when a template is saved, and an unreadable document is never
   overwritten.
8. A tile can declare an **active condition** (a control or state plus basic logic, e.g. `power > 0`);
   the tile renders as active, rules can react to it (`when: "active"`), and each slot can be limited
   to active / inactive / both — e.g. the Brunnen's power badge only while the pump runs.

## 2. Decisions

| # | Decision |
|---|---|
| A18 | A tile is **materialised iff it has `slots`**: the first edit of any tile-config field (size, background, slot, rule, apply template) writes a **complete** `{template, size, slots}` — the ledger's partial-`size` contradiction ends here. **Reset** drops `tile`. Legacy/partial tiles keep resolving from the chain (no migration). |
| A19 | Templates are authored **from a tile** and applied **from the tile pane** (`/templates` page and the device-form `template` field stay later). Save writes a per-type template (size + slots + CSS background; features copied from the resolved template); apply **replaces** size + slots + background after a confirm; same name+type overwrites after a confirm. The **title stays per-placement** (`Placement.title`) — a type template must not stamp one device's name onto every tile of that type. The first save writes `templateList` (version 1); no proactive seeding, and an unreadable document disables saving. |
| A20 | Placeholder resolution: with a `source` → resolve to control or state. Without a source and **without a hint** → positional fallback (presets' "show two values", unchanged). Without a source **with** a hint (`options.pick`: a curated name or free text) → resolve by **role → label → unit**; no match → **dormant** (renders nothing, stays in the config), never a positional stand-in. A dormant slot comes alive when the editor binds it or the device gains a matching control (resolution is at render time). |
| A21 | A slot `source` naming an existing **state object** (not a device control) resolves to a control-shaped **read-only** pseudo-control (value/unit/label from the object, no write semantics, no history spec). Kinds offered for raw states: value, icon, badge. The pages store registers such sources as used state ids so they are subscribed. |
| A22 | The tile **background** is `TileConfig.background` (`Background` reused, `backgroundCss` renders it) for solid/gradient/image; the **history chart** background is a `sparkline` slot with `options.background: true`, drawn behind the content. Both ride in templates. |
| A23 | Icons stay one raw string. `Icon` renders `<img>` for image-shaped values (URL, data:, absolute or broker-relative path) and the symbol span otherwise; `iconUrl()` resolves broker-relative values (`<raw>` → `/…`) at render. The picker offers: material symbols (bundled names list, search), icons used in this document, every `common.icon` from loaded objects/enums, and a URL field. **No upload/data-URLs.** |
| A24 | The handoff key `iHome.editLayout` carries a selection: `{pageId}`, `{pageId, sectionId}`, or the full tile ref (old shape still parses as a tile). Ctrl/Cmd+click on a display **section header** or **page tab** opens `#/layout` with that node selected; the tree folds everything except the target path and unfolds the target. The per-tile Ctrl/Cmd+click folds the same way. |
| A25 | **I8**: the tile pane's device row gets *Change…* (single-pick DevicePicker); changing the device drops the materialised `tile` after a confirm — title and new-line survive. |
| A26 | **I9**: the tile pane gets *Move to section…* (target page › section, appended at the end); the tree's ↑↓ refines position afterwards. |
| A27 | **M2**: `duplicatePlacement`/`cloneSection` and template save/apply **deep-copy** the tile config (slots, rules, options, background, size) — no shared nested references. |
| A28 | One shared **BackgroundEditor** serves pages and sections (kind select; solid → colour input; gradient → two colours + angle; image → URL); a stored value that does not match the structured shape falls back to a raw text field so hand-written CSS stays editable. The page pane also gains the icon glyph preview sections have. |
| A29 | **M3** rides along: the display bar resolves a stale/empty `view.lastPage` to the first page, so a tab is always highlighted. The picker focus trap + tree keyboard contract (**I11**) stays its own slice; the new overlays copy the existing pattern and close on Esc. |
| A30 | A tile carries an **active condition** `TileConfig.active = {source, op, value?}`: a device control, a placeholder, or any state, with basic logic (`truthy`, `gt`, `gte`, `lt`, `lte`, `eq`, `ne`; numeric when both sides read as numbers, else case-insensitive equality). Its live result is the tile's **active** flag: a `.active` class on the tile (default look: the accent border; louder styling is a rule), an `active` local available to every rule on the tile, and `Slot.showWhen` (`"active"`/`"inactive"`; absent = both) for per-slot visibility. Setting a condition is a tile-config edit and materialises; a tile with no condition is never active. |
| A31 | **Value-driven slot visibility**: a rule may carry **`only: true`** — a visibility gate rather than a style. While at least one gate is present and none matches, the slot hides; the verdict is applied *after* the last-match-wins fold, so a later `hidden: false` cannot reopen it, and a broken gate expression fails closed (the rule's live result dot is the guard). Badge slots honour `hidden`/`only` exactly like body slots — their own rules and the control's — so a warning badge appears precisely while its condition holds (`when: battery < 30` ☑ only + tone `danger`). The pane's rule editor gains the *only* checkbox. |
| A32 | **The chart layer** (supersedes A22's "drawn behind the content"): a `sparkline` slot with `options.background: true` renders *over* the tile's content at `z-index: 1` (badges keep z 2; `pointer-events: none`), and its drawing **stretches to the tile** (`preserveAspectRatio="none"`): the fixed 120×28 coordinate box used to be letterboxed into the tall tile, leaving an ~11px strip in the middle — hidden behind the icon and values. The chart is centred at **70% of the tile's height** so the badge corners and the name keep their space; the stroke stays 1.5px (`non-scaling-stroke`). In-body sparklines keep the 120:28 aspect. |
| A33 | **The tile's painted background renders** (spec §5.4 realised — the field was stored, edited and template-copied but never drawn): `Tile.svelte` puts `backgroundCss(tile.background)` on the tile element ahead of a rule's `background`, so the live condition still wins. The tile pane's docked preview paints the **section's** background behind the tile (the page stays out, section border not drawn), so a tile is judged in its section — the bare-tile look of T26 changes deliberately. The section preview was already correct (supersedes T26's bare preview). |
| A34 | **A slot declares where it lives** (supersedes the reserved `TileConfig.modal`, now deleted): `Slot.where?: "tile" \| "both" \| "modal"` — absent = tile, so existing documents render unchanged. The editor presents exactly the three states per slot: a "Lives in" picker in the expanded slot editor (hidden for badge slots and the chart layer) and a row badge (`tile + modal` / `modal only`). `setSlotWhere` refuses — the tile untouched — to leave no slot on the main tile; the "modal only" option disables itself beforehand, so the tile never empties. The modal renders the slots with `where ≠ "tile"` through the same `SlotRenderer` (full vocabulary, rules and `showWhen` included, the `onPrimary` action kept, secondary emphasis) and opens only when at least one resolves into it — the automatic all-controls enlargement and its `extraControls` reachability end here. It shows the tile's own name and paints the tile's background. The tile pane's docked preview renders the modal's look below the tile — the same `ModalPanel` the dialog uses, its rows capped — so shifting a slot between the two is visible on both sides at once ("No slot lives in the modal." while there is none). Cross-device `Slot.from` stays deferred. |

## 3. Architecture

One writer path, unchanged: the store holds the registry, the editor mutates it, the store debounces
the document write, the display reads the same store. `templateList` is a second document with the
same pattern (it already has parse + debounced write; it gains a commit function and a writability
gate).

```
placement.tile?.slots  ??  resolveTemplate(device) chain        (the slot list)
        │
        ├─ pickSlotControls(slots, controls, rawStates)  →  [{slot, control?}]   (pure, tested)
        ├─ slot.rules + control.rules → resolveStyle      (existing)
        └─ Tile.svelte renders: background chart layer, slots, badges   (existing components)
```

The editor writes through the same `tile-ops` used by the renderer's contract, so the preview cannot
drift from the display (it *is* the display component).

## 4. Data model

`src/lib/types/display.ts` (all additions optional; existing documents stay valid):

```ts
interface TileConfig {
  template?: string;        // exists: the chain source at materialisation ("copied from …")
  size?: Size;
  background?: Background;  // new: the CSS background (solid/gradient/image)
  active?: ActiveCondition; // new: what "active" means for this tile
  slots?: Slot[];           // exists: their presence marks the tile as materialised
}

interface Template {        // existing + one field
  /* id, name, builtin?, basedOn?, type, size?, features */
  background?: Background;  // new
  slots: Slot[];
}

export type ActiveOp = "truthy" | "gt" | "gte" | "lt" | "lte" | "eq" | "ne";

interface ActiveCondition {
  source: string;   // control feature → id → stateId, a placeholder hint, or a raw state id
  op: ActiveOp;
  value?: string;   // the right-hand side; unused by `truthy`
}
```

`Rule` is unchanged; `Slot` gains one field:

```ts
interface Slot {
  /* kind, source, from?, label?, unit?, options?, rules? — unchanged */
  showWhen?: "active" | "inactive";  // new; absent = both
}
```

The other new meanings ride on existing fields:

- `options.pick` = a curated hint (`temperature`, `humidity`, `power`, `energy`, `battery`) **or any
  free text** matched case-insensitively against role, then label, then unit.
- `options.background: true` = this sparkline slot is the tile's background chart.
- `options.index` / `options.position` / `options.of` / `options.from` keep their current roles.

### 4.1 Model rules

1. **Materialise contract:** `materialiseTile(device, templates)` → `{ template, size, slots }`, where
   `slots` is the resolved slot list (preset → template → device, frozen) and `template` records
   `device.template ?? presetForType(device.type).id`. A tile is materialised iff `slots` is present.
2. **First edit materialises.** Every tile-config op goes through `ensureTile` first (size and
   background included). Placement fields (`title`, `newLine`, `device`) never materialise.
3. **Reset** removes `tile` entirely (no empty object left behind).
4. **Dormancy is data, not deletion**: a dormant slot stays in `slots` (bound later or removed by
   hand); the pane marks it "not assigned".
5. **Templates are deep copies both ways**: saving copies into the registry, applying copies out;
   editing one side never touches the other.
6. **Raw-state slots are read-only**: no writes, no history kinds; the editor only offers the
   read-only kinds for them.
7. **A legacy partial `tile`** (e.g. only `size`) renders as today — slots from the chain, size from
   the tile — and the pane offers the first materialising edit.
8. **Size is never adjusted automatically.** Adding slots does not cap or resize the tile: the grid's
   rows are min-content, so content grows the row anyway, and the size fields sit in the same pane
   when the declared span should grow with it.
9. **The active condition is evaluated live** on every render: its source resolves like a slot source
   (control → placeholder → raw state); `truthy` uses the app's on/off reading (`true`/`1`/`"1"`/
   `"true"`), the comparisons read both sides as numbers when both parse as finite numbers and
   otherwise compare case-insensitively as strings. A tile with no condition is never active. A
   raw-state condition is registered as a used state id like a raw slot source.
10. **`showWhen` filters before the control pass**: a slot hidden by the tile's state is removed
    before the positional walk, so it never claims "the next free control" and shifts another slot.

## 5. Renderer

1. `Tile.svelte`: the slot list is `tile?.slots ?? template.slots`; the icon slot, badge slots and
   the main-value key all derive from that list (they currently assume the chain's list).
2. The control-assignment pass (`source` → control, positional fallback, hint match, used-set walk)
   moves out of the component into a pure `pickSlotControls(slots, controls, rawStates)` in
   `tile-ops`/`template-ops` with tests: positional **only** when a slot has no source and no
   hint; a failing hint → dormant (A20).
3. Raw states: a slot source matching no control but naming a state object becomes a pseudo-control
   (`{id: source, stateId: source, liveValue, unit, label, writable: false}`) read from the live
   cache; it renders through the value slot / badge path. History kinds and writes require a real
   control.
4. Chart background: slots with `options.background` render in an absolutely-positioned layer behind
   the content (the sparkline SVG stretched, muted); the flow ignores them. `tile.background` goes
   through `backgroundCss` on the tile element.
5. `Icon` (new, common): used by the display bar tabs, section headers, tree rows, `IconSlot` and
   rule icons; `<img>` when `isImageIcon(raw)`, the symbol span otherwise, `iconUrl(raw)` for paths.
6. `GroupSection` section header: Ctrl/Cmd+click → `requestLayoutConfig({pageId, sectionId})` +
   `#/layout`; the shown cursor/tooltip makes the gesture discoverable without changing the display's
   look. `AppBar` page tabs: the same with `{pageId}`.
7. Subscription: when the page registry loads or changes, the pages store registers every slot
   source that exists as a state object and is not a device control via `registerProgramStateId`,
   so raw-state slots update live (values must arrive, not just render once). A raw-state **active
   condition** is registered the same way.
8. **Active state**: the condition is evaluated once per render from its live value into a boolean;
   `active` is added as a scope local for every rule on the tile (so "change the icon when the pump
   runs" is a rule with `when: "active"` and nothing else), the tile carries an `.active` class whose
   default look is the accent border (`var(--tile-accent, var(--primary-color))`, no glow — louder
   styling is a rule), and `showWhen` removes non-matching slots before the control pass (rule 10).

## 6. Editor UI

`LayoutDetails` tile branch grows into the tile editor, top → bottom:

| block | contents |
|---|---|
| title · device | existing title field; device row + **Change…** (A25, confirm) |
| general options | size w×h (existing, now materialising) · **Background** (BackgroundEditor + "history chart": adds/binds the background sparkline slot) · **Active when** (source via SlotPicker, operator, value; cleared = removed) · new-line (existing) |
| slots | ordered rows, kind glyph + summary ("value · temperature", "badge · battery"); expanded: kind, source (SlotPicker), label, unit, per-kind knobs (`index`, `pick`/free text, badge `position`, level `min/max/step`, decimals), visibility (both / only active / only inactive; shown in the summary), ↑↓, delete; dormant rows say "not assigned — bind or remove"; header shows "copied from <source>" + **Reset** when materialised |
| rules | per slot, collapsible: ordered list (last match wins) — `when` (virtual-formula language, live result dot), icon (IconPicker), colour (colour input), glow, background, hidden, only, disabled, tone; add / remove / reorder; the field hint says `active` is available |
| templates | **Save as template** (name field, default the tile's title) · **Apply template** (select of the device type's templates; confirm — replaces size, slots, background) |
| move | **Move to section…** (A26) |
| preview | unchanged — the display's own `Tile` at the real breakpoint |

The **`+`** (tree tile row and the end of the slot list) opens the **SlotPicker** overlay with three
tabs: *Device controls* (the tile's device, excluding controls already used by a slot) · *By
placeholder* (curated hints + free text) · *Any state* (the StatePicker/StateTree machinery). The
picked entry becomes a slot whose kind derives from the control (switch → value, level → level,
colour → colour, enum → enum, else value), editable afterwards. On add: materialise, append, select
the tile.

**Folding on handoff**: the tree takes a `focus` prop (changed only when a handoff arrives) and folds
every page except the target's, every section except the target's; for a page target its sections
stay folded (the page lists its sections); for a section target it unfolds to show its tiles; for a
tile target it unfolds both the page and the section that hold it, with the tile selected.

## 7. Pickers

- **SlotPicker** (new, in `components/layout/`): overlay in the `DevicePicker` pattern; the *Any
  state* tab reuses `StatePicker`'s machinery (`collectStates`/`buildStateTree`/`applyFilters`).
- **IconPicker** (new, in `components/common/`): tabs Symbols (searchable grid from a bundled
  `material-symbol-names.json`, result window capped), Document (icons used anywhere in `pageList`,
  deduped), Broker (`common.icon` values from `ioBroker.objects` + `ioBroker.enums`, deduped, shown
  as images so a broken path is visible before choosing), URL. Stored value = the raw string.
- **BackgroundEditor** (new, shared): kind select; solid → `<input type="color">`; gradient → two
  colour inputs + angle (writes `linear-gradient(<angle>deg, a, b)`; detected by shape on load, else
  raw text field); image → URL field; a clear action removes the background.
- Overlay behaviour copies the existing pattern (backdrop, Esc closes); the full focus trap and tree
  keyboard contract stay I11's slice.

## 8. Error handling

| case | behaviour |
|---|---|
| slot source resolves to nothing | dormant; the pane marks it and offers bind/remove |
| the active condition's source resolves to nothing | the tile is not active; the pane marks the condition |
| a state id stops existing | slot goes dormant (render checks object/state presence) |
| apply template on an unmaterialised or foreign tile | confirm first; the document is written only through the store's path |
| `templateList` unreadable (present but unparsable) | **saving is refused**, a visible note in the pane; the document is never overwritten (same rule as `pageList`) |
| `templateList` absent | writable: the first save creates it, `version: 1` |
| template write fails | the pane shows "templates not saved"; the registry stays in memory (mirrors the pages indicator) |
| icon URL 404 | the `<img>` breaks visibly; the picker showed the image before choosing; the value stays raw and fixable |
| device change with a materialised tile | confirm says the layout resets; cancel keeps everything |
| empty/free-text pick matches nothing | dormant, never a positional stand-in (A20) |

## 9. New/changed files

| file | change |
|---|---|
| `src/lib/types/display.ts` | `TileConfig.background`, `Template.background` |
| `src/lib/config/tile-ops.ts` (new) | `materialiseTile`, `ensureTile`, `resetTile`, `addSlot`/`removeSlot`/`moveSlot`/`patchSlot`, `addRule`/`patchRule`/`removeRule`/`moveRule`, `saveAsTemplate`, `applyTemplate`, `evalActive` |
| `src/lib/config/tile-ops.test.ts` (new) | every op: materialise completeness + no shared refs, ensure-once, reset, slot/rule index ops, template round-trip independence, the `evalActive` matrix (truthy / numeric / string / eq-ne) |
| `src/lib/config/template-ops.ts` | `pickSlotControls` extraction (+ free-text hint matching); `materialiseTile` uses the same resolution |
| `src/lib/config/template-ops.test.ts` | the new pass: positional only without a hint, hint fail → dormant, used-set order, raw-state sources |
| `src/lib/config/layout-ops.ts` | `parseLayoutRef` (generalised `parsePlacementRef`), `movePlacement` reuse, deep copy in `clonePlacement` (A27) |
| `src/lib/config/layout-ops.test.ts` | `parseLayoutRef` shapes, deep-copy independence |
| `src/lib/utils/icon-url.ts` (new) | `isImageIcon`, `iconUrl` |
| `src/lib/utils/icon-url.test.ts` (new) | URL/data:/absolute/relative/symbol cases |
| `src/lib/config/appearance.ts` | gradient build/inspect helpers (used by BackgroundEditor) |
| `src/lib/config/appearance.test.ts` | gradient shape round-trip |
| `src/lib/assets/material-symbol-names.json` (new) | the symbol name list (fetched once from Google's icon metadata, committed) |
| `src/lib/stores/templates.svelte.ts` | `commitTemplates`, `isTemplatesWritable`, `templateSaveFailed` |
| `src/lib/stores/pages.svelte.ts` | registers raw slot sources as used state ids on load and on every commit |
| `src/lib/components/common/Icon.svelte` (new) | img-or-symbol |
| `src/lib/components/common/IconPicker.svelte` (new) | the four-tab icon picker |
| `src/lib/components/common/BackgroundEditor.svelte` (new) | shared page/section background editor |
| `src/lib/components/layout/SlotPicker.svelte` (new) | the source picker (3 tabs) |
| `src/lib/components/layout/LayoutDetails.svelte` | the tile editor (slots, rules, templates, change device, move, reset), page background + icon preview |
| `src/lib/components/layout/LayoutTree.svelte` | tile-row `+`, `Icon`, fold-on-handoff |
| `src/lib/components/display/Tile.svelte` | slot list source, dormancy, raw states, chart background, active evaluation + `.active` class, `Icon` |
| `src/lib/components/display/GroupSection.svelte`, `AppBar.svelte` | section/tab Ctrl+click handoff, `Icon`, M3 |
| `src/lib/components/display/slots/*`, `SlotRenderer.svelte` | pseudo-control acceptance, rule-icon `Icon` |
| `src/routes/layout/+page.svelte` | slot-picker state, generalised handoff (page/section/tile), wiring |
| `src/lib/pages.js` | `requestLayoutConfig` / `takeRequestedLayout` (replacing the placement-only pair) |
| `docs/superpowers/specs/` | this spec |

## 10. Testing & verification

- **Pure, vitest** (repo style): `tile-ops` (materialise is complete and shares no references with
  the source; `ensureTile` materialises once; reset removes the key; slot/rule ops keep order; save →
  apply is independent of the template; the `evalActive` matrix — truthy, numeric and string
  comparisons, eq/ne), `pickSlotControls` (positional only without source+hint; failing hint →
  dormant; `showWhen`-hidden slots are dropped before the walk and never claim a control; used-set
  prevents double-assign; raw-state pseudo-controls), `iconUrl`/`isImageIcon`, `parseLayoutRef`, the
  gradient builder and its shape detection.
- **Live browser pass** (Playwright against the real broker, per repo convention): add a slot with
  `+`, bind a placeholder, add a rule with glow, save a template and apply it to another tile,
  a chart background, a broker image icon on a section, Ctrl/Cmd+click a section header (fold
  verified), change a tile's device, move a tile across sections, Reset; widths 375/820/1400; the
  document read back (materialised shapes, `templateList` version 1); no unintended broker writes.
  Live-check traps from the handoff apply: JSON-encoded localStorage values, a port that never
  served a build (the service worker precache).
- **Gates before "done":** `npm run check` (0/0), `npm test`, `npm run lint` (0), `npm run build`
  (writes `www/`).

## 11. Phases

1. **Types + pure ops + tests** (no UI): `tile-ops`, `pickSlotControls` + A20 semantics, `icon-url`,
   `parseLayoutRef`, deep copy (A27), gradient helpers, templates store commit + writability gate.
2. **Renderer**: `Tile.svelte` (slot list source, dormancy, raw states, chart background), `Icon`,
   used-state registration, `GroupSection`/`AppBar` routing + M3 — verifiable on the live display
   before any editor UI exists.
3. **Editor**: the pane rework, `SlotPicker`, `IconPicker`, `BackgroundEditor`, tree `+` and
   fold-on-handoff, page/section pane polish.
4. **Live verification pass** + gates, then the handoff document.

## 12. Risks

| risk | mitigation |
|---|---|
| A failing hint no longer falls back positionally — a live thermometer without humidity loses a row (it used to show the next control, possibly mislabelled) | This is spec §6 read strictly ("a slot with no hint takes the next control") and the behaviour the templates need; the live check compares before/after and the pane shows the dormant slot |
| A template's `showWhen: "active"` slot applied to a tile with no active condition never shows | The pane marks such slots ("only when active — no active condition set"); adding the condition is one edit |
| Materialisation enlarges `pageList` (each edited tile carries its slots) | Bounded by the number of edited tiles; the document is one JSON state and stays readable; Reset removes the weight |
| The first `templateList` write lands on the live broker | The save is an explicit user action; the document is created `version: 1` with only the saved template; unreadable → refused |
| Broker icon paths resolve to the wrong base URL | `iconUrl` is one small tested rule; the picker renders each candidate image, so a broken one is visible before choosing; the stored value stays raw |
| Two editor instances writing templates (two tabs) | Same last-write-wins as `pageList`, documented; no new exposure |
| The pane becomes the densest UI in the app | Blocks are collapsible (slots/rules per slot); the preview sits in the same pane so every edit is judged live |

## 13. Non-goals

- The tile **enlargement** is built as the slots' `where` (A34); cross-device slots (`Slot.from`) and
  per-control write states stay S2.
- The `/templates` library page, template delete/rename UI, template inheritance/`basedOn` editing,
  and the device-form `template` field — later slices; this slice authors and applies from the tile
  pane only.
- Active conditions **inside templates**: templates carry size/slots/background; a slot's `showWhen`
  rides with the slot, and the pane flags active-only slots when the tile has no condition.
- Section `member`/filter builder, `showEmpty` toggle and per-section width hints — not selected for
  this slice.
- Icon **upload** / data-URL images in the document.
- History kinds (sparkline/history-list) on raw-state slots (there is no history spec for them).
- Drag-and-drop in the pane or the tree (↑↓ moves remain); the I11 accessibility slice (focus trap,
  tree keyboard contract); undo/redo; packaging and the repo push.
