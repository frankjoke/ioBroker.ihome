# Context (DOC)

11 implementation plans ingested, one per SPEC in this set. Each entry is keyed by topic and carries
its source path. Plan-level contracts (test-first steps, file lists, review focus, gates) live here;
the binding design rules they implement live in `constraints.md`.

---

## Device configuration UI — implementation plan
- source: docs/superpowers/plans/2026-10-09-device-config-ui.md
- notes:
  - Goal: a config UI to build the device list — devices holding multiple state IDs with optional
    per-direction (input/output) transforms, plus a filtered tree-view state picker showing current
    value and last-changed. Spec: `2026-10-09-device-config-ui-design.md`.
  - Architecture: pure logic first (transform engine, feature table, state-tree/filter builder,
    formatters) as unit-tested modules, then thin Svelte 5 runes components; the existing
    `stores/devices.svelte.ts` registry + `registry.svelte.js` persistence are reused.
  - Global constraints: Svelte 5 runes + TypeScript, no legacy `createEventDispatcher`/`on:`; no new
    runtime dependencies; vitest `environment: "node"`, `expect.requireAssertions: true`; registry id
    `DEVICE_LIST_ID = "0_userdata.0.Test.AiHome.deviceList"`; only **used** states are cached (the
    picker fetches on demand, never into the state cache); `applyRead`/`applyWrite` never throw;
    JSON-path transforms are read-only; per-task definition of done `npm run lint` clean,
    `npx svelte-check` 0 errors, `npm run build` succeeds.
  - Review focus (each pinned by a test in its owning task): bad formula (syntax or runtime throw) →
    raw value + `error`, never a throw; scale with `inMax === inMin` → returns `outMin`, never
    NaN/Infinity; JSON path on a non-object or missing path → original value, no throw; legacy
    registry transform → migrated, not dropped; picker fetch where one id fails → the failing id is
    skipped and a missing state renders as unavailable.
  - Tasks: 1 transform engine (`transform-ops.ts`, types, `utils/transform.ts` rewired to `runStep`);
    2 feature model (`features.ts`: `DEVICE_FEATURES`, `featureDef`, `widgetFor`, `suggestFeature`);
    3 state tree + filters (`state-tree.ts`: `collectStates`, `applyFilters`, `buildStateTree`);
    4 formatters (`format.ts`: `formatAge`, `formatValue`); 5 wiring (enriched `widget`,
    `migrateRegistry` on load, `picker-values.svelte.js`); 6 `StatePicker` + `StateTree` (deletes
    `StateSelectModal.svelte`); 7 `TransformEditor`; 8 `ControlRow` + `DeviceForm` (deletes
    `DeviceEditor.svelte`); 9 config page CRUD + nav tab; 10 Devices page widget rendering + inline
    edit.
  - Note in the plan: "This directory is not a git repo" — `git init` once or skip every commit step.

## Formula templates — implementation plan
- source: docs/superpowers/plans/2026-10-10-formula-templates.md
- notes:
  - Goal: a named, reusable library of virtual-state formulas in its own setup ID, managed in Settings,
    applied from the virtual-state editor modal (copy-on-select with a provenance link).
  - Architecture: pure `config/formulas.ts` (seed, `applyTemplate`, `syncFormulaId`, `migrateLibrary`)
    behind a persistence layer `formulas.svelte.js` (mirrors `registry.svelte.js`) and a store
    `stores/formulas.svelte.ts`; Settings hosts CRUD; the editor becomes a modal with a template picker
    and Save-as-template.
  - **Declared deviation from spec §5:** the spec named a polling `formulaListStore` readable; the plan
    reads the module `$state` directly in `$derived` (exactly as `devices/+page.svelte` reads
    `getCanonicalRegistry()`), which is reactive without a poll. Stated cost if wrong: a component that
    reads the library outside a reactive context would not update — none do.
  - Constraints: devices hold a copy (deleting a template must never break a device); persistence
    mirrors `registry.svelte.js`; modals mirror `StatePicker.svelte`; confirmations use
    `ConfirmModal.svelte`; ≥1 assertion per test, colocated `*.test.ts`; gates `npm test`,
    `npm run lint`, `npm run check`, `npm run build`, then `graphify update .`.
  - Review focus: `syncFormulaId` clears on mismatch and on a dangling id; `applyTemplate` copies
    `expr`/`precision`/`unit` and sets `formulaId`; `migrateLibrary` tolerates a JSON string, a `{val}`
    wrapper and malformed/partial entries; the seed's dew point is the real Magnus formula
    (references `Math.log`), not the linear approximation; deleting a template leaves existing
    controls working.
  - Tasks: 1 model + pure helpers + seed (+ `project.ts` persistence); 2 persistence + store + init;
    3 Settings management UI; 4 editor modal + `ControlRow` + `DeviceForm`; 5 full verification.

## Virtual states — implementation plan
- source: docs/superpowers/plans/2026-10-10-virtual-states.md
- notes:
  - Goal: read-only computed/aggregate controls on devices, driven by an editable JavaScript expression
    over the device's own state values plus a helper API over all device-defined states.
  - Architecture: `kind: "virtual"` on `Control` (absent ⇒ `"state"`); a pure engine
    (`config/virtual-ops.ts`) sanitizes labels, builds the scope (locals + helpers) and evaluates with
    `new Function`, returning `{ value, error? }` and never throwing; the existing enrichment in
    `stores/devices.svelte.ts` builds the device-state pool once per pass and computes each virtual
    control's `liveValue`/`virtualError`.
  - Constraints: no new runtime deps; errors never throw (same policy as `config/transform-ops.ts`);
    a control with no `kind` is a state control; vitest node env, ≥1 assertion per test; gates
    `npm test`, `npm run lint`, `npm run check`, `npm run build`.
  - Review focus: a formula naming an unavailable sibling → `undefined` + error, never a crash;
    aggregate over an empty set → the documented empty-set semantics; two labels sanitizing to the same
    identifier → suffixed and resolvable; non-numeric members in numeric aggregates → no `NaN` leak
    (numeric strings coerce, non-numeric ignored, booleans 1/0); switching a control State↔Virtual and
    saving → no stale `stateId`/`transform`/`virtual` fields persisted together incorrectly.
  - Tasks: 1 model + engine core; 2 scope builder, helper API, `computeVirtual`; 3 persist virtual
    fields; 4 enrich virtual controls in the store; 5 `VirtualEditor` component; 6 `ControlRow` kind
    selector + `DeviceForm` add-virtual; 7 dashboard rendering; 8 full verification.

## History controls — implementation plan
- source: docs/superpowers/plans/2026-10-13-history-controls.md
- notes:
  - Goal: a state-backed control reads ioBroker history for its state (backwards duration hours/days,
    granularity = sample count or interval + aggregate) with a summary line (point count, min/max,
    sparkline) in the device config list and on the devices page.
  - Architecture: `Control.history` as an optional property (not a new kind) bound to the control's own
    `stateId`; pure `config/history-ops.ts` builds `getHistory` options, reduces to `{ ts, val }`,
    summarizes, trims and draws; `stores/history.svelte.ts` fetches lazily on first render then appends
    live updates; `HistoryEditor` modal configures it, `HistorySummary` renders it.
  - Constraints: history data is reduced to `{ ts, val }` pairs only (never `from`, `ack`, `q`); the
    read path never throws (a failed `getHistory` → `status: "error"` + message); `Control.history` is
    only meaningful with a `stateId` (virtual controls never get one); `history` absent ⇒ no history.
  - Review focus: a range with no points → `status: "empty"`, "no data", `""` sparkline, no crash;
    `getHistory` fails → `status: "error"`, no retry storm; `count` **and** `step` set → count wins
    (also step-only, count-only, neither); a live update older/equal or non-numeric → not appended, no
    duplicate; `common.custom` entries all `enabled: false` → the history button is not offered.
  - Tasks: 1 model + read core; 2 summary, trim, append, sparkline, labels; 3 persist the history
    property (`projectControl`); 4 history store (injected client, no socket import); 5 `HistoryEditor`
    modal; 6 history button + summary line in the device editor; 7 summary lines on the devices page;
    8 full verification. The plan adds `appendLive` and `stepMs` as named exports alongside the spec's
    helper list.

## iHome display (basics) — implementation plan
- source: docs/superpowers/plans/2026-10-14-ihome-display.md
- notes:
  - Goal: the iHome display — a page → group → device dashboard with a module grid, tile templates,
    built-in presets and value-driven effects — as the new `/` route.
  - Architecture: all decision-making in pure modules under `src/lib/config/*.ts` (membership
    resolution, template merging, rule evaluation, span clamping); thin components
    `PageView` → `GroupSection` → `Tile` → `SlotRenderer` → slot components; config in two new ioBroker
    JSON states beside `deviceList`.
  - Constraints: no new dependencies; pure logic in `src/lib/config/<name>.ts` with a sibling test;
    **new stores must not use module-global client injection** (import the shared `ioBroker` and/or
    take the client as an argument — the history store was broken by that under Vite HMR); vitest node
    env, `requireAssertions: true`, no DOM/component tests; gates `npm test`, `npm run check`,
    `npm run lint`, `npm run build`; state ids verbatim
    `0_userdata.0.Test.AiHome.pageList` and `…templateList`.
  - **Breakpoint/size constants stated in the plan (do not use — see INGEST-CONFLICTS.md):** "phone
    `<600px` tile 150px max `1x2` · tablet `600–1024px` tile 170px max `2x2` · desktop `>1024px` tile
    190px max `4x4`", asserted in Task 3 as
    `[["phone", 150, 1, 2], ["tablet", 170, 2, 2], ["desktop", 190, 4, 4]]`. The spec's table (45/90,
    51/102, 57/114 with max 2/2, 4/3, 4/4) is the governing one.
  - Other plan-level constants: badge tones `info | ok | warn | danger`; an `ago` badge turns `warn` at
    86 400 000 ms (24 h); English identifiers, 2-space indent, repo prettier config; the package/adapter
    is not renamed.
  - Review focus: a group whose `member` is `{}` → **nothing** renders, not every device; an unknown
    `device.template` id → the preset for `device.type`; a throwing `when` expression → the rule does
    not match and the tile still renders; all controls `hidden` → the device is absent unless
    `showEmpty`; a missing state object (`available === false`) → the tile renders with an `offline`
    badge and no `ago`, never the text `undefined`.
  - Not in this plan: spec phases 4–5 (the `/pages` and `/templates` editors, the device-form
    additions, kiosk polish beyond the last-page memory).
  - Tasks: phase 1 — 1 display model + persisted device fields, 2 enum membership for functions/
    favorites, 3 tile span clamping, 4 page and group resolution, 5 template merging + built-in
    presets, 6 rule evaluation + implicit badges; phase 2 — 7 page/template stores seeded on first run,
    8 display shell/page view/module grid, 9 Tile + SlotRenderer + value/control slots; phase 3 —
    10 effects from rules, 11 badges (declared and implicit), 12 sparkline and history-list slots,
    13 full-control modal, 14 filter chips and view state, 15 subscribe the states rules and `watch`
    reference.

## iHome layout editor (P1) — implementation plan
- source: docs/superpowers/plans/2026-10-15-ihome-layout-editor.md
- notes:
  - Goal: the pages → sections → tiles tree editable in the app, with section appearance and automatic
    flow, and the display rendering exactly what the editor wrote.
  - Architecture: `pageList` stays the single source of truth and gains two optional fields on a
    section (`appearance`, `tiles`); a pure `migratePageRegistry` expands the seeded document once
    (version 0 → 1); a pure `layout-ops` module holds every tree mutation; a new `#/layout` route
    renders the tree, a device picker and a details pane with a live preview through the *same* display
    components.
  - Constraints: identifiers are `ihome`/`iHome` (never reintroduce `visual-interface`); no new runtime
    or dev dependencies; Svelte 5 runes only (`$state`/`$derived`/`$effect`, `onclick={}`,
    `{#each … (key)}`); every new pure function gets a vitest test in the house style (small local
    factory, no fixtures, no component harness); documents are written **only** through `savePages()`
    from `stores/pages.svelte.ts` — a component never calls `ioBroker.setState` for `pageList`;
    `Group.member` is a hint only after Task 3; `version` stays 1 after migration and P1 never writes
    `tile` contents.
  - Gates: `npm test` all pass, `npm run check` 0/0, `npm run lint` **exactly the 5 known pre-existing
    errors** (`Tile.svelte` mutable `Set`, `pages.js` `sessionStorage` ×3, unused import in
    `control-write.test.ts`), `npm run build` before the branch is done. Keep `cwd` at the repo root
    for `svelte-check`/`eslint` (a `.svelte-kit/` inside `src/` throws ~300 phantom lint errors).
  - Live checks: the real broker at 192.168.178.9, with
    `localStorage["__VISUAL__:hostPort"] = "\"192.168.178.9:8081\""` (JSON string). The seeded
    `pageList` is the user's real data: migration must be additive, the first write after migration is
    the only one that changes it, and an unreadable document is never written.
  - Review focus: a placement whose device no longer exists → the page skips it; absent/empty/garbage
    documents → absent/empty seeds, garbage is never overwritten, migration runs on neither; duplicate
    page/section → fresh ids; reordering to an edge → no-ops or exact landings; section appearance
    boundaries (`border: false` vs absent, background set vs unset).
  - Tasks: 1 model (placements, section appearance, `Slot.from`); 2 `migratePageRegistry`; 3 the
    renderer resolves placements, not members; 4 `layout-ops` (every tree mutation, pure); 5 commit path
    + the one-time migration of the live document; 6 the display (sections flow, appearance, placement
    titles); 7 `#/layout` (route, tree, page/section/tile CRUD); 8 details pane + live preview;
    9 device picker; 10 reachability (Ctrl/Cmd+click and edit mode). Pre-work noted: commit the
    uncommitted `ihome`/`iHome` rename, the green switch glow and the tracing before Task 1.

## iHome tile editor (P2) — implementation plan
- source: docs/superpowers/plans/2026-10-16-ihome-tile-editor.md
- notes:
  - Goal: edit a tile where it lives — slots (values, badges, icons) with per-slot rules, an active
    condition, its own size and background, saved as a per-type template and applied to other tiles —
    plus page/section polish (background editor, icon picker) and the display → editor Ctrl/Cmd+click
    routing.
  - Architecture: `Placement.tile` stays the only per-tile store and follows Approach A (A18): the
    first tile edit **materialises** the tile; a tile is materialised iff it has `slots`; after that it
    diverges and the renderer reads it verbatim; **Reset** drops `tile`. Every mutation is a pure
    function (`tile-ops`, `template-ops`, `layout-ops`) committed through one write path
    (`commitLayout`); templates have their own registry and path (`commitTemplates`). Raw-state slots
    get pseudo-controls and are registered as used state ids like device slots.
  - Constraints: branch `feature/ihome-display`; no new runtime/dev dependencies; Svelte 5 runes only;
    one write path per document (a component never calls `ioBroker.setState` directly); every tile
    **content** edit goes through `tile-ops` so materialisation happens in exactly one place; documents
    are never overwritten while unreadable (`isLayoutWritable` / `isTemplatesWritable`); gates
    `npm test`, `npm run check` (0 errors 0 warnings), `npm run lint` (0), `npm run build`; live checks
    with `localStorage["__VISUAL__:hostPort"]` (JSON — the quotes are part of the value); the broker
    documents are `pageList` (version 1, the user's real data — additive changes only) and
    `templateList` (absent; written only by a template save); `graphify update .` after each committed
    task.
  - Review focus: hand-written/odd documents (unknown `active.op`, a bad `showWhen` value, `active`
    without a source, `slots: []`, a dangling device on a materialised tile) must degrade, never throw;
    an unreadable `templateList` → the save path refuses and says so, and a later good save may not
    silently replace it; icon strings that are neither a symbol nor a URL → symbol text, never a broken
    `<img>`; dormancy must not shift other slots (a Thermometer without humidity loses exactly one row);
    materialisation edges (a legacy partial `tile` keeps its size on first edit, `slots: []` counts as
    materialised, Reset drops the whole tile).
  - Tasks: 1 model + materialise contract; 2 slot and rule ops + `editTile`; 3 slot resolution
    semantics (`pickSlotControls`, `slotVisible`, free-text hints); 4 `evalActive`; 5 templates
    (`templateFromTile`, `upsertTemplate`, `applyTemplate`) + the writable registry; 6 `icon-url.ts`
    (image vs symbol, `collectDocumentIcons`); 7 `appearance.ts` (gradient builder + inspector);
    8 handoff protocol (`parseLayoutRef`, deep-copied placements, one request pair); 9 renderer core
    (the tile's own slots, raw states, dormancy); 10 renderer (active state, chart background, `Icon`);
    11 display routing and chrome (Ctrl/Cmd+click, `Icon`, the M3 tab fix); 12 `IconPicker` + the symbol
    list; 13 `BackgroundEditor` + page/section backgrounds; 14 `SlotPicker` + the tile-row `+`; 15 tree
    (`Icon` rows, fold-everything-except); 16 tile pane part 1 (general options, templates, device,
    move, reset); 17 tile pane part 2 (the slots list and the rules editor); 18 whole-slice live
    verification + gates + handoff.

## Layout sheet — implementation plan
- source: docs/superpowers/plans/2026-10-19-ihome-layout-sheet.md
- notes:
  - Goal: finish the layout sheet on `feature/layout-sheet` — replace the two things the spike
    approximated, add the one piece nobody has seen (click-a-tile-in-the-display), and retire what the
    sheet replaces. Spec: `2026-10-18-ihome-layout-sheet-design.md` (A43–A50).
  - Architecture: the editor is a mode of the display route (`LayoutSheet.svelte`, opened by the app
    bar's pencil); its navigation is a pure cursor (page → section → tile → device) with one editor at a
    time in the body. Two pieces of logic move out of components into pure modules so they can be
    tested: the cursor's fallbacks and a tile's resolved parts (the sheet must ask "does this tile have
    anything in the detail page?").
  - Already built on the branch (verified live — do not rebuild): A43, A44, A45's wiring, A47, A50.
  - Constraints: work in the worktree
    `C:\Users\franz\.local\share\opencode\worktree\c399be\spike\layout-sheet`, branch
    `feature/layout-sheet` (the main checkout stays untouched); gates after every task — `npm test`
    (328 passing today), `npm run check` (0 errors, 0 warnings), `npm run lint`, `npm run build`;
    Svelte 5 runes only; **never write to the live ioBroker document while verifying** (browser checks
    are read-only; a write is the user's call); every behaviour-changing decision gets a spec row and a
    line in `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md`; one commit per task.
  - Review focus: a placement whose device was deleted (nothing throws; the Device line reads "no
    device"; the display skips the tile); an empty page or section (the selectors still render, the body
    shows nothing); a tile whose only modal content is a frame slot (the detail page still opens and
    closes); a click on empty space selects nothing; a handoff for a tile on another page (the display
    follows the cursor's page and the app bar's tab with it).
  - Tasks: 1 the cursor as a pure module (`sheet-cursor.ts`: `sheetCursor`, `swapDecision`);
    2 a tile's resolved parts as one helper (`tile-parts.ts`: `SlotRow`, `TileParts`, `hasModal`);
    3 both consumers use the helper (drop `hasModalParts`, remove `showPreview` and A33's preview
    block); 4 click a tile in the display to select it (`tile-hit.ts` `placementAt`, the selection
    layer, `data-page-id`/`data-section-id`/`data-placement-id` on the tile root); 5 retire the tree and
    the spike's leftovers (delete `LayoutTree.svelte`); 6 the ledger and the handoff.

## Slot icons — implementation plan
- source: docs/superpowers/plans/2026-10-19-ihome-slot-icons.md
- notes:
  - Goal: the icon becomes a property of the slot it decorates — editable glyph, per-slot enable, its
    own display home — while legacy `kind: "icon"` slots keep rendering exactly as today and fold onto
    their slot on request. Spec: A51–A58. (All task boxes are checked in this plan.)
  - Architecture: one optional descriptor on `Slot` (`icon?: { glyph?, enabled?, where? }`); the slot's
    existing rules dress it; `tile-parts` answers the icon question once (headline pick, per-row
    visibility); `tile-ops` carries the mutations (`patchIcon`, `foldIconSlot`); the renderer (cluster
    in `SlotRenderer`, header and rows in `ModalPanel`) and the editor (the icon block in
    `LayoutDetails`) consume those pure answers.
  - Constraints: gates after every task (`npm test`, `npm run check` 0/0, `npm run lint` 0,
    `npm run build`); Svelte 5 runes only; one commit per task with A-numbers in the message; **every
    browser check is read-only** against the live setup (no toggling icon fields on live tiles, no
    "Move into its slot" — the interactive pass on real tiles is the user's); the pure modules own every
    decision, components consume them (no second answer); comments explain the why and name the
    A-decision.
  - Review focus: legacy fidelity (with a `kind: "icon"` slot present the tile renders — accent, glow,
    dim — exactly as today, and `pickSlotControls`' icon non-consumption is untouched); one resolution
    (tile cluster, modal rows and header all read `tile-parts`' answers); the fold is faithful and never
    silent (glyph, `where` and rules carry, rules appended last; the target's icon is overwritten only
    when the fold carries one; nothing happens without a click + confirm); every preset's icon lands on
    the slot its source named (or the headline), pinned by a test.
  - Tasks: 1 the descriptor and the resolution (`headlineSlot`, `rowIcon`, `SlotIcon`; the picker's
    Document tab learns `glyph`); 2 the mutations (`patchIcon`, `iconSlotTarget`, `foldIconSlot`);
    3 the presets (the fold table per type: Switch `power_settings_new`, Button `touch_app`, Light
    `lightbulb`, Thermostat `thermostat`, Thermometer `device_thermostat`, Blind `blinds`, Window
    `window`, Motion `sensors`, AC `ac_unit` at index 3, Value `speed`, Custom `widgets`; plus a
    preset-integrity test); 4 the renderer (the wrapping cluster, accent source, header/row icons —
    sizes: header 26, rows 18); 5 the editor (icon block, headline tag, legacy marker + fold confirm)
    and the picker (drop the `icon` kind); 6 live verification and the handoff (the interactive pass is
    listed as the user's checklist rather than performed).
  - Known interim state at plan time: between Tasks 3 and 4 no descriptor renders yet, and between
    Tasks 4 and 5 the fold is unreachable from the UI — both commit-bounded, gates green throughout.
  - Not in this plan: the spec's non-goals (no second rules UI, no badge/frame icons in the editor, no
    `kind: "icon"` retirement — that came the next day, A56).

## Slot sparklines — implementation plan
- source: docs/superpowers/plans/2026-10-20-ihome-slot-sparklines.md
- notes:
  - Goal: the chart becomes a property of the value slot it describes — one chart area on the tile with
    all its series, and a chart inside each value's detail row — retiring `kind: "sparkline"`. Spec:
    A59–A64. (Task boxes are unchecked in this plan; the artefacts it names exist in the repo.)
  - Architecture: a per-slot `Slot.spark` descriptor (the A51 icon pattern) resolved by pure functions
    in `tile-parts` (`tileSeries`, `rowSpark`, `hasHistory`, colours from a theme palette) and drawn by
    one new `TileChart` component in two places (the tile's background layer, the modal row's middle
    cell). The history store keeps fetching per control — nothing moves there.
  - Constraints: TypeScript strict, Svelte 5 runes, no new dependencies; pure logic in
    `src/lib/config/*` (`tile-parts.ts`, `tile-ops.ts`, `history-ops.ts`); vitest with
    `expect.requireAssertions`; one commit per task, complete only when `npm test`, `npm run check`,
    `npm run lint` and `npm run build` are green; **live documents are written only through the app's
    store** (`commitLayout`, `updatedAt` bumped) — no direct `set_state` outside that one approved
    migration; neither the page/tile group ids nor the device ids change; palette order is fixed.
  - Review focus: a `spark` whose control resolves to nothing (typo'd source) → draws nothing, throws
    nothing, the editor says so; a constant or single-sample series → the flat centre line, never an
    empty `<svg>` or a division by zero; two series in different units → each spans the full height, x
    is shared, no NaNs; a tile whose only charted value is modal-only → the tile still charts (A60) and
    the row chart shows only in the modal; a narrow row with a chart, a long label and a long value →
    the value must not be pushed out of the row.
  - Tasks: 1 the descriptor and the resolution (`SlotSpark`, `seriesPoints`, `hasHistory`,
    `CHART_PALETTE`, `tileSeries`, `rowSpark`, `parts.rows`, `patchSpark`); 2 migrate the live document
    (dry-run report first, then the store write, then read back and verify); 3 the renderer
    (`TileChart.svelte`, `.tile-bg`, the modal row, delete `SparklineSlot.svelte`); 4 the editor
    (the Sparkline block, drop the chart dropdown, retire the kind from `KIND_GLYPH`, `DEVICE_KINDS`,
    `needsControl`, `SlotKind`); 5 docs and handoff.
  - Task 2 detail: the dry-run report is expected to fold Rooms/Bad, Home/Klima and Garten-Pool Light
    onto an existing row and to report the two Brunnen tiles as "inserted"; the write asserts zero
    `"kind":"sparkline"` occurrences, five `"spark"` descriptors and the two inserted rows with
    `where: "modal"`.

## Device icons — implementation plan
- source: docs/superpowers/plans/2026-10-21-ihome-device-icons.md
- notes:
  - Goal: a device shows the icon its ioBroker objects carry (resolved up the hierarchy), and every
    icon URL resolves against the ioBroker host instead of the app's origin. Spec: A65–A69. (Task boxes
    are unchecked in this plan; the artefacts it names exist in the repo.)
  - Architecture: pure resolution in a new `icon-ops.ts` (`ownerOf`, `objectIconValue`, `resolveIcon`,
    `deviceObjectIcon`) plus a base-aware `iconSrc` in `icon-url.ts`; the device enrichment carries the
    resolved icon on `EnrichedDevice.objectIcon`; `Icon.svelte` is the single image renderer (tile name,
    detail header, devices page, pickers, enum badges).
  - Constraints: TypeScript strict, Svelte 5 runes, no new dependencies; pure logic in
    `src/lib/config/*` and `src/lib/utils/icon-url.ts` — components only render; vitest with
    `expect.requireAssertions`; one commit per task; `npm test`, `npm run check`, `npm run lint`,
    `npm run build` green after each; the resolution rules are fixed by A65 (per object
    `modelIcon` → `extIcon` → `icon`, nearest object first, then `system.adapter.<adapter>.<instance>` →
    `system.adapter.<adapter>`); slot icons (A51) and the documents are untouched — nothing is written
    into a document.
  - Review focus: a device whose controls resolve nothing renders exactly as today (no icon, no
    placeholder, no error); a symbol name (`lightbulb`) must never be turned into a URL; `iconSrc` with
    no configured `hostPort` and no DOM must still return a usable string, never `undefined` or
    `"undefined/…"`; a relative icon on `enum.*` → best-effort path, no crash, no infinite loop in the
    parent walk; a GitHub `extIcon` on the dev origin → the tile, header and devices row must render it
    (or show nothing, never a broken image icon).
  - Tasks: 1 `icon-ops.ts` + the base-aware `iconSrc` (keep `isImageIcon` and `collectDocumentIcons`,
    add `iconBase()`); 2 one image renderer (`Icon` gains `owner`; `EnumBadge`/`MultiSelect` drop their
    `isUrl`); 3 the device enrichment carries the icon (`EnrichedDevice.objectIcon`); 4 the four places
    show it; 5 docs and handoff.
  - Task 4 step 1 as written: "the tile's name line renders `<Icon value={device.objectIcon} size={15} />`
    before the text when present (the name line becomes a flex row, the icon not shrinking)" — this
    contradicts spec A67 and the shipped component (see INGEST-CONFLICTS.md).
