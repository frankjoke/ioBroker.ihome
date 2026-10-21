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
| A29 | **M3** rides along: the display bar resolves a stale/empty `view.lastPage` to the first page, so a tab is always highlighted. The picker focus trap + tree keyboard contract (**I11**) stays its own slice; the new overlays copy the existing pattern and close on Esc. **(Superseded by A43–A49, the layout sheet: there is no tree any more.)** ||
| A30 | A tile carries an **active condition** `TileConfig.active = {source, op, value?}`: a device control, a placeholder, or any state, with basic logic (`truthy`, `gt`, `gte`, `lt`, `lte`, `eq`, `ne`; numeric when both sides read as numbers, else case-insensitive equality). Its live result is the tile's **active** flag: a `.active` class on the tile (default look: the accent border; louder styling is a rule), an `active` local available to every rule on the tile, and `Slot.showWhen` (`"active"`/`"inactive"`; absent = both) for per-slot visibility. Setting a condition is a tile-config edit and materialises; a tile with no condition is never active. |
| A31 | **Value-driven slot visibility**: a rule may carry **`only: true`** — a visibility gate rather than a style. While at least one gate is present and none matches, the slot hides; the verdict is applied *after* the last-match-wins fold, so a later `hidden: false` cannot reopen it, and a broken gate expression fails closed (the rule's live result dot is the guard). Badge slots honour `hidden`/`only` exactly like body slots — their own rules and the control's — so a warning badge appears precisely while its condition holds (`when: battery < 30` ☑ only + tone `danger`). The pane's rule editor gains the *only* checkbox. |
| A32 | **The chart layer** (supersedes A22's "drawn behind the content"): a `sparkline` slot with `options.background: true` renders *over* the tile's content at `z-index: 1` (badges keep z 2; `pointer-events: none`), and its drawing **stretches to the tile** (`preserveAspectRatio="none"`): the fixed 120×28 coordinate box used to be letterboxed into the tall tile, leaving an ~11px strip in the middle — hidden behind the icon and values. The chart is centred at **70% of the tile's height** so the badge corners and the name keep their space; the stroke stays 1.5px (`non-scaling-stroke`). In-body sparklines keep the 120:28 aspect. |
| A33 | **The tile's painted background renders** (spec §5.4 realised — the field was stored, edited and template-copied but never drawn): `Tile.svelte` puts `backgroundCss(tile.background)` on the tile element ahead of a rule's `background`, so the live condition still wins. The tile pane's docked preview paints the **section's** background behind the tile (the page stays out, section border not drawn), so a tile is judged in its section — the bare-tile look of T26 changes deliberately. The section preview was already correct (supersedes T26's bare preview). |
| A34 | **A slot declares where it lives** (supersedes the reserved `TileConfig.modal`, now deleted): `Slot.where?: "tile" \| "both" \| "modal"` — absent = tile, so existing documents render unchanged. The editor presents exactly the three states per slot as a **tri-state icon button in the slot row, before the move arrows** (not a select or a badge): `crop_square` = tile, `splitscreen` = tile + modal, `open_in_full` = modal only, tinted while not at the default. A click cycles tile → both → modal → tile; `nextSlotWhere` **skips "modal" while this is the only slot left on the tile** so the click never lands on a refused move. Badges and the chart layer can live in the modal too, so no row hides the button. The row's second button does the same for visibility (A30): `all_inclusive` = always, `toggle_on` = active only, `toggle_off` = inactive only — the Visibility select and both row badges are gone. `setSlotWhere` still refuses — the tile untouched — to leave no slot on the main tile, as the backstop behind the skip. The modal renders the slots with `where ≠ "tile"` through the same `SlotRenderer` (full vocabulary, rules and `showWhen` included, the `onPrimary` action kept, secondary emphasis) and opens only when at least one resolves into it — rows *or* badges. Badges take their own path: a badge's corner anchor is the tile's language, so in the modal they are read-only chips on the title line, all of them (no per-corner cap), rendered by the `BadgeChip` that `BadgeRow` also uses — tile and modal chips cannot drift. The panel shows what lives in it and nothing else: the tile's name with the chips beside it, then the rows — the device type and room badges the head used to carry are gone. A chart-layer sparkline loses its stretch when it lives in the modal: there it is a plain sparkline row. The automatic all-controls enlargement and its `extraControls` reachability end here. It shows the tile's own name and paints the tile's background. The tile pane's docked preview renders the modal's look below the tile — the same `ModalPanel` the dialog uses, its rows capped — so shifting a slot between the two is visible on both sides at once ("No slot lives in the modal." while there is none). Cross-device `Slot.from` stays deferred. |
| A35 | **Slots are keyed by position, never by content**: two identical slots are legal config and render as two rows — the display must never merge them or crash on them. (A real document with a duplicated `{kind:"value", source:"temperature"}` threw Svelte's `each_key_duplicate` and took the whole layout pane down with it: the pane rendered nothing usable, its open picker could not be closed — Cancel and Escape both "did nothing" because every re-render re-threw — and the offending row could not be deleted through the UI, so the document looked broken beyond repair. Only editing it outside the app would have helped.) The tile's body, the chart layer, the modal's rows and the badge chips iterate with the index as key, so any duplicate renders side by side and stays deletable; the headline reading is the first value **row**, so a duplicate never becomes a second headline. `pickSlotControls` passes duplicates through untouched (pinned by a test). The modal's row label treats an empty control label as absent (`\|\|`, not `??`), so such a row shows the control's feature, its source or its kind instead of a blank. |
| A36 | **A source names one control, and an icon spends none.** The slot picker writes a control's *feature* only while that feature is unique on the device — it is portable, the slot survives the device being rebuilt; when two controls share it (a bathroom thermometer's `ACTUAL` and `TAUPUNKT` are both honestly `value.temperature`), it writes the control's **id**, because a feature naming two controls resolves to whichever comes first in the device, not the one that was picked (`sourceForControl`, the write side of `resolveControl`). Related, in the resolver: an **icon slot reads a control without consuming it** — a readout (source/hint/bare) claims its control so the next bare readout moves on, but an icon's source only feeds its colour and its rules. Before this, the thermometer preset's icon and its first value both meant `temperature`, so the value hint skipped the control the icon had spent and the tile's temperature readout showed the **dew point** — a reading the user never put there, while the slot they *did* add read the temperature. The same starvation left a device whose preset ends in a bare readout (`Value`) showing no reading at all. Both pinned by tests. |
| A37 | **A slot row names what the slot reads; a hint is marked as one.** The row's second part is a name, not the binding instruction: the control the slot reads **under the device's own name for it** (`label`, else `feature`) — the same words the picker and the device editor use; a source that names no control (a raw state) keeps its **state id**, and a hint shows the control it resolves to *right now*, on a fresh hand, because the display walks the slots in order and grows a used-set (A36). A hinted row carries a muted **"(hint)"** marker, so a followed hint is never mistaken for a pinned control (the earlier pane showed the bare hint word *and* the raw source string, which read as the same thing — the confusion A36 came from). The slot's own name stays the **Label** field. The fold-out editor's bare raw-text button becomes a labelled **Source** field on the **Kind** row (same level of importance), with an edit affordance: it shows that same name, keeps the raw source string in its tooltip, and opens the source picker — the pane's only route to re-bind a slot, and it was there all along, just unreadable as a control. The hint field is renamed **Hint** and carries one line saying what a hint does (the display resolves it while rendering, which is how one template fits every device). Picking a Source **drops the slot's hint** on the way in (`setSlotSource`): the source always wins, so the hint behind it is dead weight, and an options object left empty goes with it. (Found while re-running the gate: `ModalPanel`'s row type was too narrow for the `feature` its label chain reads — svelte-check had been red on `HEAD`; widened here.) |
| A38 | **A frame is a slot, and it reads a page, not a control.** `kind: "frame"` with `options.url` shows any web page in an `<iframe>` — an ioBroker web-adapter page (eCharts, Energiefluss) or any URL. It is a slot and not a background because a live page cannot be a CSS background, and because a page needs exactly what slots already have: `where` (tile / both / modal), rules, `showWhen`, order, and the modal's row. The resolver walks it through **without a control**: it neither claims the next free control nor goes dormant (pinned by a test), so a bare value below it still gets the control it means. On the tile it fills the body under the tile's name: the body is **full width** and grows into the leftover height, so the frame tracks the tile exactly (a shrink-to-fit body left the iframe at its own 300px default — the tile grew, the page did not), and the tile's span decides how much of the page shows; in the modal it takes the **panel's whole width with no label column**, tall as the panel's own budget (`--panel-max` — 70vh in the dialog, 30vh in the pane preview), never scaled by the tile's size: the modal is the enlargement, not a scaled tile. Editing: the pane's fold-out shows a **URL** field where a control slot has its Source — a frame has no control, so its hint row and note are hidden there — and the row itself shows the URL; the slot picker gained a **"Web page"** tab (URL box + “Add page”), which the source-mode picker never offers. No sandbox attribute: these pages need their own scripts and storage, and they live on their own origin, so they cannot reach into the display's document. The one trap: an iframe swallows pointer events, so on a tile where the frame fills the body the tile's own gestures (the long-press for the modal) die over that area — `where` helps (keep the readable part on the tile and the page in the modal), and **A39 switches the pointer off entirely**. |
| A39 | **A frame can be told to ignore the pointer.** `options.inert` puts `pointer-events: none` on the iframe, so presses fall through to the surface under it: the tile keeps its own long-press (which is what opens its modal) and the modal keeps its gestures, while the page can no longer be hovered, clicked or scrolled — a picture, not a control. Per slot, default off (interactive), ticked in the pane's fold-out as **"ignore pointer"** beside the URL. It applies wherever the slot renders — a `both` frame is a picture on the tile *and* in the modal — so tick it for pages you only look at (a chart preset) and leave it off for pages you drive (Energiefluss). |
| A40 | **An add shows you what it made.** The device picker's add selects the first placement it created, and the tree **opens the path to the current selection** — the page and the section. Opening only: nothing else folds (unlike a handoff's `focus`, which folds the tree to one target), and folding the section by hand afterwards stays folded, because the effect watches the selection, never `folded`. The trap this closes: a section whose tiles are all behind a fold shows neither them nor any add button — the section-level `+` lives on the *empty* row and the per-tile `+`s live on tile rows — so a fresh tile could disappear behind a fold and the add looked like it did nothing (found by placing a device into a folded `Zentrale`). **(Superseded by A43–A49, the layout sheet: there is no tree any more.)** ||
| A41 | **A tile can have no name.** A placement's `title` has three states: absent → the device's name (`tileTitle`, so a renamed device carries the tile with it), a string → that name, and **`""` → no name at all** — the tile renders no name line and its body gets the space back. The pane's **Tile title** field keeps meaning "absent" when it is cleared (its placeholder shows the derived name, and the field is dead while the checkbox is on); a **"no name"** checkbox on the same line as the field writes `""`. The tree row and the modal header keep naming the tile (both fall through with `\|\|`), so it is anonymous on the wall yet findable in the editor. Before this there was no way out: clearing the field was the only gesture and it *fell back* to the device's name, so a tile on a device with no name of its own showed the type name — `Custom` — with no way to get rid of it. The document side is pinned by a parse test (`""` survives the round trip; `isPlacement` accepts any string). |
| A42 | **The tree is an accordion, and it scrolls in place.** A section is folded until something opens it — a handoff, a selection (A40), or a click — and **opening one folds every other**, so the tree shows one room's tiles at a time instead of the whole document: the live document went from 1994px of tree with 34 sections open to 840px of room rows and none open. Pages stay open (they are one row each; the sections are the bulk), and folding a section by hand leaves nothing open rather than opening a sibling. The card scrolls on its own — sticky under the 44px app bar, height capped — so a long list can never push the pane beside it out of view (before, the whole editor page scrolled and the pane slid away while you worked deep in the tree). A handoff's `focus` still folds everything to its one target. **(Superseded by A43–A49, the layout sheet: there is no tree any more.)** ||

| A71 | **A tile's active state can dress it (2026-10-21).** `TileConfig.look = {active?, inactive?}` with `StateLook = {glow?, color?, glyph?, background?}` (`glow`/`color` CSS colours, `glyph` a symbol, `background` the full `Background`). A field set here wins over the rules for that state; an absent field keeps what the rules resolved. The **inactive look is also the tile's default**: a tile that never becomes active (no condition, or its condition false) wears it, so the pane can edit glow/icon/background without any active condition and the values carry over as the inactive state when one is added (`stateLook`, `tile-parts`). `glow` glows in that colour (`--tile-glow-color`; the border keeps the accent), `color`/`glyph` replace the headline icon's colour/glyph (respecting its off switch and `where`), `background` is painted last with `backgroundCss`, over the tile's own and any rule background. Dimming (`disabled`) stays rule territory. The pane's *Look* block always exists: one block (labelled *default*) without a condition, *active* + *inactive* blocks with one; each block carries the glyph picker (previewing the headline's device/template glyph while unset), glow/icon colour selects (`setLook`, `tile-ops`; badge colour names plus a custom hex, `default` = keep the rules) and the same `BackgroundEditor` the tile's own background used (solid/gradient/image), prefilled with the tile's own background when the state sets none. |

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
