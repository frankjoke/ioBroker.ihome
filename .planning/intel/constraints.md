# Constraints (SPEC)

11 SPECs ingested. **No ADRs and no PRDs are in this set** — the decisions these specs carry are
A-numbered design decisions, not Accepted ADR records, and no doc is marked `locked`. Entries below
are grouped per spec; every entry names its source path. Values are quoted from the specs.

---

## Transform engine contract (per-direction steps)
- source: docs/superpowers/specs/2026-10-09-device-config-ui-design.md
- type: api-contract
- content:
  - `Transform = { read?: TransformStep; write?: TransformStep }` replaces the bidirectional
    `scale`/`map` mix; `TransformKind = "scale" | "map" | "formula" | "jsonpath"`.
  - `TransformStep`: `scale` (inMin/inMax/outMin/outMax, optional `clamp`, optional `round` decimals)
    | `map` (key lookup via `String(v)`; unknown key → pass through) | `formula` (evaluate `expr`
    with `x` bound: `new Function("x", "return (" + expr + ")")`, wrapped in try/catch; on error the
    raw value is used and an error flag surfaced) | `jsonpath` (dot segments + `[n]` indices only —
    `sensors[0].value` — **not** full JSONPath).
  - `applyRead(v, transform)` / `applyWrite(v, transform)` keep their current signature and return
    the transformed value — **never throw**.
  - `runStep(step, v)` returns `{ value, error? }` and backs `previewTransform(step, v)`, which the
    editor calls for the live preview.
  - **jsonpath is read-only**: the Write direction offers no JSON-path step and passes the value
    through (a write step has no access to the target object).
  - Migration on load: `{ type:"scale", inMin..outMax, clamp }` → read+write scale steps;
    `{ type:"map", read, write }` → read/write map steps; an already-migrated transform passes through.

## Device / Control schema and the feature table
- source: docs/superpowers/specs/2026-10-09-device-config-ui-design.md
- type: schema
- content:
  - `DeviceType = Switch | Light | Thermostat | Blind | Window | AC | Thermometer | Value | Custom`
    (9 members as of this spec — extended to 11 later, see the display spec below).
  - `Control = { id, feature, stateId, writable, readable, label?, unit?, hidden?, transform? }`.
  - `Device = { id, name, type, room?, section?, panel?, icon?, controls[] }`; `DeviceRegistry`
    (`version`, `updatedAt`, `devices`) unchanged. `EnrichedControl` gains `widget` (resolved from
    the feature) so the Devices page does not re-derive it.
  - `FeatureDef = { feature, label, widget, roleHints[] }`, `Widget = switch | level | color | value |
    enum | button`; `DEVICE_FEATURES: Record<DeviceType, FeatureDef[]>`.
  - Feature table: Switch→power(switch); Light→power(switch)/brightness(level)/color(color)/
    colorTemp(level); Thermostat→actual(value)/setpoint(level)/mode(enum); Blind→position(level)/
    stop(button); Window→open(switch); AC→power(switch)/mode(enum)/temperature(level)/fan(level);
    Thermometer→temperature(value)/humidity(value); Value→value; Custom→value/power/level.
  - `suggestFeature(obj)` scans `obj.common.role` then `obj.common.type` against the selected type's
    `roleHints` and returns the first match; fallback `value` for readable-only, `power` for
    `common.type === "boolean"`.
  - Rendering: the Devices page renders by widget (`switch`, `level` slider, `color`, `value`
    read-only, `enum` select from `common.states`, `button` momentary `setState`); unknown/unavailable
    states render as a disabled value row. Writes go `applyWrite` → `ioBroker.setState`.

## State-picker value policy
- source: docs/superpowers/specs/2026-10-09-device-config-ui-design.md
- type: nfr
- content:
  - Values are fetched **on demand** for the visible leaf set (decision: no broad caching, no cache
    pollution): `getState` per visible id, parallel, capped at the page size.
  - Results live in a picker-local map keyed by id; each entry shows `valString` and a relative age
    from `ts`.
  - Leaves are capped/paged (default 200) to bound work; filters narrow the set first.
  - Filters: adapter instance | room | type | role | search text; rooms from `ioBroker.enums`
    (`enums.get(id)?.rooms`, `enums.getList("rooms")`), type/role from `object.common`.
  - Multi-select; each selected state becomes a `Control` with an auto-suggested feature, editable
    afterwards.

## Virtual control model and evaluation engine
- source: docs/superpowers/specs/2026-10-10-virtual-states-design.md
- type: api-contract
- content:
  - `Control.kind?: "state" | "virtual"` — **absent ⇒ `"state"`** so existing registries load
    unchanged; `virtual?: VirtualSpec` (`{ expr: string; precision?: number }`) present when
    `kind === "virtual"`; virtual controls are read-only (`writable: false`, `stateId` absent).
  - `EnrichedControl` for a virtual control: `liveValue` = computed result,
    `exists = available = true`, `widget = "value"` (or `"enum"`), `virtualError?: string`.
  - `sanitizeLabel(label, taken)` → JS identifier (lower-case, spaces/symbols → `_`, invalid chars
    stripped, collisions get an index suffix: `temperature`, `temperature2`).
  - `buildScope(device, pool)`: **locals** = the device's *state-backed* controls keyed by sanitized
    label → live value (v1 excludes other virtual controls); **globals** = the helper API over the
    **device-state pool** (every state referenced by any device), each entry
    `{ stateId, value, role, room, device, feature, label }`.
  - `evaluateVirtual(expr, scope)` compiles via
    `new Function(...localNames, ...helperNames, "return (" + expr + ")")` in try/catch and
    **never throws**: on failure `{ value: undefined, error }`.
  - Helpers: `get(ref)` (stateId string, or `{device, label}`, also `device("Kitchen").temperature`),
    `values(filter)`, `count(filter, pred?)`, `sum/avg/min/max(filter)`, `any/all(filter, pred?)`;
    `filter = { role?, room?, device?, feature?, label? }` — every provided key must match.
  - Empty-set semantics: `count` → 0, `sum` → 0, `any` → false, `all` → true,
    `avg/min/max` → undefined.
  - Errors render the value as `—` with an inline warning (same policy as transform errors).

## Virtual states — v1 limits
- source: docs/superpowers/specs/2026-10-10-virtual-states-design.md
- type: nfr
- content:
  - No fan-out / group writes; no server-side computation (client-side in the visual layer only).
  - No access to arbitrary ioBroker states — only states already referenced by devices.
  - No sandbox/worker isolation beyond the existing `new Function` trust model.
  - No dependency resolution between virtual states in v1 (avoids cycles; revisit with ordered
    evaluation + cycle detection).
  - Recompute is reactive: the enriched store re-derives when any used state changes; memoization
    is a later option.
  - No migration required; virtual controls are additive.

## Formula library — storage, shape and seed
- source: docs/superpowers/specs/2026-10-10-formula-templates-design.md
- type: schema
- content:
  - `FormulaTemplate = { id, name, expr, precision?, unit?, notes? }`;
    `FormulaLibrary = { version, updatedAt, formulas[] }`.
  - `Control.formulaId?: string` — source template **while unmodified**, cleared on edit; kept in
    `projectControl`.
  - Storage: `0_userdata.0.Test.AiHome.formulaList` (a `json` state, same shape as `deviceList`),
    created on first connect if missing; persistence mirrors `registry.svelte.js`
    (`parseLibrary`, `ensureFormulaObject`, debounced 250 ms `saveFormulas`, echo-suppressed
    `onUpdate`, `initFormulas` waits for the socket, loads once, seeds when absent/empty).
  - Seed written **only when the state is absent/empty** — 5 templates: Dew point (real Magnus
    formula, unit `°C`, precision `1`), Count low battery
    (`count({ role: "value.battery" }, v => v < 20)`), Any motion active
    (`any({ role: "sensor.motion" })`), Sum of active power (`sum({ feature: "power" })`, unit `W`),
    Average temperature (`avg({ role: "value.temperature" })`, unit `°C`, precision `1`).
  - Pure helpers in `config/formulas.ts`: `SEED_TEMPLATES`, `seedLibrary()`,
    `applyTemplate(control, template)`, `syncFormulaId(control, library)`, `migrateLibrary(raw)`.
  - No migration required; `formulaId` is optional and absent on all current controls.

## Formula templates — copy-on-select reuse semantics
- source: docs/superpowers/specs/2026-10-10-formula-templates-design.md
- type: api-contract
- content:
  - Picking a template **copies** its `expr`/`precision`/`unit` into the control and sets `formulaId`.
  - `formulaId` is cleared the moment `expr` no longer equals the source template's `expr` (the
    control becomes "custom"); a `formulaId` that no longer resolves is treated as custom and cleaned
    on load.
  - **No live-link evaluation**: devices hold a copy, editing a template does not retro-change
    devices, and deleting a template never breaks a device.
  - No per-user/shared/remote sync; no reorder/versioning of templates in v1.
  - Management: Settings page CRUD (list of name / expression preview / unit / notes, Edit + Delete
    with confirm, Add form); creation also via **Save as template** in the virtual-state editor modal.
  - `VirtualEditor` becomes a modal, auto-opened for a newly added virtual control, otherwise via an
    **Edit formula** button.

## History — model and getHistory options
- source: docs/superpowers/specs/2026-10-13-history-controls-design.md
- type: schema
- content:
  - History is an **optional property of an existing state control** (`Control.history`), **not** a
    new control kind: a history belongs to a state, so the binding is the control's own `stateId`.
  - `HistorySpec = { duration: number; durationUnit: "hours" | "days"; count?: number; step?: number;
    stepUnit?: "seconds" | "minutes" | "hours"; aggregate?: HistoryAggregate }` with
    `HistoryAggregate = average | min | max | total | count | none | onchange`.
  - `projectControl` persists `history`; enriched extras are still dropped.
  - **`EnrichedControl` is unchanged** — enrichment is synchronous and history is asynchronous; the
    history store owns the fetched data and the UI reads the store directly.
  - No migration required; `history` absent ⇒ no history.

## History — read contract
- source: docs/superpowers/specs/2026-10-13-history-controls-design.md
- type: api-contract
- content:
  - `historyEnabled(obj)` → true when `obj.common.custom` has ≥1 entry with `enabled !== false`.
  - `durationMs(spec)`: hours → 3 600 000, days → 86 400 000.
  - `historyKey(stateId, spec)`: stable cache key from `stateId` + the spec fields.
  - `buildHistoryOptions(spec, now)` → `{ start: now - durationMs, end: now, ignoreNull: true }`, then
    `{ count }` if `count` is set (**count wins over step**), else
    `{ step: stepMs, aggregate: spec.aggregate ?? "average" }`.
  - `toSeries(result)` → `{ ts, val }[]`: reads `result.result`, keeps only finite numeric `val` and
    numeric `ts`, **drops every other ioBroker field** (`from`, `ack`, `q`, …), sorts by `ts`,
    de-dupes equal `ts`.
  - `summarize(series)` → `{ count, min?, max? }`; `trimSeries(series, {windowMs, count?, stepMs?, now})`
    drops points older than `now - windowMs` and caps at the newest `count` or
    `ceil(windowMs / stepMs)`.
  - `sparklinePoints(series, width, height, pad)` → SVG polyline `points` string; handles 0 points
    (`""`), 1 point and a flat series (mid-line).
  - Granularity is either a sample `count` or an interval `step` + `aggregate`; **if both are given,
    count wins**. Duration units are hours and days only.
  - The read path **never throws**: a failed `getHistory` becomes a store entry with `status: "error"`.

## History — store and loading policy
- source: docs/superpowers/specs/2026-10-13-history-controls-design.md
- type: nfr
- content:
  - `Map<historyKey, Entry>` in `$state`, `Entry = { status: "loading" | "ready" | "empty" | "error";
    series: {ts,val}[]; fetchedAt: number; error? }`.
  - `ensureHistory(stateId, spec)` fetches once if the key is absent; empty result ⇒ `status: "empty"`;
    `refreshHistory` re-fetches the whole range.
  - `readHistory(stateId, spec)` is a **pure read** — the live tail is fed separately, so reading
    during render never mutates state.
  - `noteLive(stateId, spec, point)` appends a live point when strictly newer than the last, trimming
    the window (plus a hard cap); components call it from the same effect that loads the row, so the
    series stays current **without refetching**.
  - Broker access is **injected** (`setHistoryClient`) by the layout — the store never imports the
    socket module (no cycle) and stays unit-testable with a stub client.
  - **No timers, no prefetch**: only keys a rendered row/modal asks for are fetched; live appends stop
    when nothing feeds the store; the editor's preview fetch is debounced.
  - Live appends are bounded by the **window** (plus a hard cap), never by `count`/`step`, so the
    "last Nh" label stays honest.

## History — availability and UI
- source: docs/superpowers/specs/2026-10-13-history-controls-design.md
- type: api-contract
- content:
  - The history button is rendered/enabled only when the control has a `stateId` **and**
    `historyEnabled(ioBroker.objects.get(stateId))`; it is highlighted when `control.history` is set.
  - Real data availability is confirmed by a real `getHistory` fetch in the modal / summary line.
  - `HistoryEditor` (modal, local draft, Cancel | Save): duration number + unit select; `count` and
    `step` + `stepUnit` + `aggregate` with a hint that count wins; live preview (sparkline + point
    count + min/max); Refresh.
  - `HistorySummary` line per history-enabled control (label, `last 24h · 200 samples`, point count,
    min/max, inline sparkline) — rendered in `DeviceForm` after the control list **and** inside each
    device row on the devices page.
  - No history for virtual controls (no `stateId`); no write-back to history; no charting in this
    iteration (the sparkline is a compact inline SVG).

## Display — documents and registries
- source: docs/superpowers/specs/2026-10-14-ihome-display-design.md
- type: schema
- content:
  - One JSON state per document, following the existing registry pattern
    (`registry.svelte.js`: create-if-missing, load on connect, echo-suppressed `onUpdate`, debounced
    write, `version` + `migrate*`).
  - State ids: `0_userdata.0.Test.AiHome.deviceList` (existing `DeviceRegistry`),
    `…formulaList` (existing formula library), `…pageList` (**new**
    `PageRegistry { version, updatedAt, seeded?, pages: Page[] }`), `…templateList` (**new**
    `TemplateRegistry { version, updatedAt, templates: Template[] }`, user templates only).
  - Built-in presets live in code (`src/lib/config/presets.ts`), frozen; "Save as copy" writes a user
    template with `basedOn: <presetId>`.

## Display — data model and model rules
- source: docs/superpowers/specs/2026-10-14-ihome-display-design.md
- type: schema
- content:
  - `Size = { w: 1..10; h: 1..10 }`; `Member` (ids/room/function/favorite/type/tags — all optional and
    ANDed); `Group { id, title?, icon?, member, showEmpty? }`; `Page { id, title, icon?, background?,
    groups[] }`; `Background { kind: "gradient"|"image"|"solid"; value }`.
  - `Slot { kind, source?, label?, unit?, options?, rules? }`; `Rule { when, icon?, color?, glow?,
    background?, hidden?, disabled?, tone? }`; `Template { id, name, builtin?, basedOn?, type, size?,
    features, slots }`.
  - `FeatureDef` (features.ts) is reused and gains `required?: boolean` so a template can insist on a
    feature. `Device` gains (all optional, additive): `functions?`, `favorites?`, `tags?`,
    `template?`, `size?`, `slots?`, `watch?`; `Control` gains `rules?`.
  - **Merge order:** preset → `device.template` → device `slots` → control-level `rules`. Slots merge
    by `(kind, source)` identity (later wins); rules concatenate and evaluate top-to-bottom,
    **last match wins**.
  - **Source resolution:** control `feature` → control `id` → raw state id (`get("<stateId>")`).
  - **Group membership:** groups with explicit `ids` are claimed **first**, then filter groups in
    order; a device claimed earlier is excluded later (no duplicate tiles; pinning wins over a filter).
  - **Empty devices** render only when the group sets `showEmpty`.
  - `Device.section` / `panel` are dead half-fields: left in place, **not** used, marked deprecated.
  - **Explicit, not derived:** filtering tests the device's own fields (`room`, `functions`,
    `favorites`, `type`, `tags`), never the enum reverse index.

## Display — slot vocabulary and renderer contract
- source: docs/superpowers/specs/2026-10-14-ihome-display-design.md
- type: api-contract
- content:
  - Closed slot vocabulary owned by the renderer; a template picks/skins/orders slots and can never
    ask for a widget that does not exist. `SlotKind` as written here: `icon | value | level | color |
    enum | button | badge | sparkline | history-list` — **as amended later**: `frame` added,
    `icon` and `sparkline` retired (see the tile-editor / slot-icons / slot-sparklines entries).
  - Rendering: `icon` material symbol (colour/glow/dim by rules); `value` formatted number/text +
    unit, a bare boolean reads On/Off (`formatSlotText`); `level` writable range slider; `color`
    colour picker; `enum` select from `common.states`; `button` press (writes `true`); `badge` compact
    icon + tone; `sparkline` inline SVG from the history store; `history-list` short last-N list.
  - **Effects** are computed once per device into CSS custom properties (`--tile-accent`,
    `--tile-glow`); `glow` is a **static box-shadow with no pulse animation**, disabled under
    `prefers-reduced-motion`.
  - **Badges**: 3 visible + `+n`; sources are declared controls (`battery`, `error`) plus two the
    renderer derives — `ago` (newest `ts` across state-backed controls) and `offline`
    (`available`/`exists` false). Unavailable devices still render with the `offline` badge.
  - An `ago` badge **names the control it watches**:
    `{ source: "ago", options: { of: "motion", from: "lc" } }`; `of` is a feature, control id, state
    id or label; `from` is `ts` (still reporting) or `lc` (last value change, falling back to `ts`);
    with no `of` the device-wide newest `ts` stands.
  - **Source resolution for a slot or badge:** feature → control id → state id → **label** (last
    resort); a feature match always wins.
  - `disabled` from a rule dims what it matches without disabling it.
  - **The display only ever moves on the broker's word**: `writeControl` emits `setState` and nothing
    else; no component writes the live cache; only the socket's `stateChange` handler and `getState`
    write it.
  - **A toggle is one write per press**: a short per-state lock (75 ms) for toggle-shaped writes;
    sliders pass no lock (every step of a drag must land). The live cache is reloaded from the broker
    on every (re)connect (`reloadUsedStates`).
  - **Badge corners**: 4 px outside the tile edge; `ago` bottom-left, `battery`/`offline`/`alarm`/
    `error` top-right, anything else top-left, bottom-right free; a slot may override with
    `options.position`; more than three in one corner collapse to `+n`.
  - **A readout declares what it shows**: `options.pick: "temperature" | "humidity" | "power" |
    "energy" | "battery"` matched against role first, then label, then unit (units exactly — `Wh` is
    not a watt); no hint → the next control no earlier slot used (positional fallback); `options.index`
    is part of a slot's identity (`kind:source:index`).
  - **Text emphasis**: the tile's first value slot is the headline (bold 0.90rem), its unit 20% smaller
    and not bold (0.72rem/400), secondary readings 0.84rem/400 (unit 0.67rem), via `splitValueUnit`; a
    boolean's unit is its false/true pair and is used as the label, never repeated.
  - Tile content hangs from the top (shared baselines); a tile's name drops a redundant type suffix
    (`Garten-Pool.Light` → `Garten-Pool`), `Device.title` overrides both.

## Display — module grid and breakpoint clamp
- source: docs/superpowers/specs/2026-10-14-ihome-display-design.md
- type: schema
- content:
  - One CSS grid per group: `grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr))`,
    `grid-auto-rows: var(--tile-min)`; a tile spans `min(w, var(--max-w))` × `min(h, var(--max-h))`.
  - Breakpoint table: phone `<600px` `--tile-w` 45px, `--tile-h` 90px, `--max-w` 2, `--max-h` 2;
    tablet `600–1024px` 51px / 102px / 4 / 3; desktop `>1024px` 57px / 114px / 4 / 4.
  - The **column module is half the row module** because `w` counts half-modules (`w:1` = the
    half-width card a readout wants, `w:2` = a plain tile's old width, `w:4` = double-wide).
  - `--tile-h` is a **minimum**: the row track is `minmax(--tile-h, auto)`, so content grows the row
    instead of clipping, and every tile in that row shares the height.
  - Font and icon sizes are deliberately untouched; values wrap to a second line rather than
    ellipsising ("a clipped number is a wrong number").
  - **No absolute placement exists anywhere**, so a new device can only append.
  - Sections render as groups: quiet header (title, count, collapse toggle) when `title` is set,
    header-less when not; page-level background only — no per-group backgrounds.

## Display — write discipline, HMR and error handling
- source: docs/superpowers/specs/2026-10-14-ihome-display-design.md
- type: nfr
- content:
  - New stores must **not** use module-global client injection: import the shared `ioBroker` and/or
    take the client as an argument — the history store was broken by a module-global client under Vite
    HMR (two `?t=` module instances meant two clients and a permanently empty cache).
  - `new Function` in rules is the same trust level as the existing virtual formulas (locally authored
    config, no remote input) — no new exposure, stated.
  - `watch` semantics: the subscription pass must union `device.watch` ids (and state ids referenced by
    rules), or rules on raw states silently never match.
  - Error handling: unparsable registry state → keep the in-memory model, ignore the write, log, never
    wipe user config; unknown template id → fall back to the preset for `device.type`; unresolvable
    slot source → skip that slot and flag the device as incomplete in the config UI; unavailable/
    nonexistent state → tile renders with the `offline` badge; expression errors → the rule simply
    does not match (surface the message in the config editor only).
  - Migration & seeding: `pageList` absent on first load → seed once with `seeded: true` (one "Home"
    page with one group per **function** plus a "Rooms" page with one group per room, both as group
    *filters*); `templateList` absent → empty list, presets come from code; existing registries are
    untouched (new `Device` fields are optional and `migrateRegistry` keeps working).
  - Test style: vitest, node env, `requireAssertions: true`; no DOM/component tests. Verification per
    phase: `npm test`, `npm run check`, `npm run lint`, `npm run build` + a browser smoke pass at
    phone/tablet/desktop widths.
  - Non-goals: charting engine, drag-and-drop layout, per-group backgrounds, absolute placement,
    vis-2 export, adapter rename/publish, remote push, animations beyond a static glow.

## Layout editor — placement model (A8–A17)
- source: docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md
- type: schema
- content:
  - **A8** A section's contents are an explicit `tiles[]` list; `member` survives only as a **filter
    hint** (seeded pages keep it, and it powers "add all matching" / "N devices in this room are not
    here").
  - **A9** A tile is a **placement**: its config lives in the tree; on first edit it is
    **materialised** from device config → its template → the preset, then diverges independently.
  - **A10** A tile configures **two surfaces** with one slot vocabulary: `slots` (the tile) and
    `modal.slots` (the enlargement). *(Later deleted — see A34.)*
  - **A11** A slot may name **another device** (`from`) — a tile is not limited to its placement's
    device.
  - **A12** Controls stay **standard state widgets** (switch, slider, number/text edit, select via
    `common.states`); structured/"special" widgets deferred.
  - **A13** Sections carry **appearance** (border, background); how they sit next to each other
    **flows automatically** from the available width — no explicit spans, column counts or pinned
    placement.
  - **A14** P1 edits the tree, section visuals and tile lists only; `tile.slots`/`modal` stay at their
    template/device defaults.
  - **A15** Document changes are **non-destructive and idempotent** (`version` 0 → 1), written with the
    existing registry pattern; conflicts are last-write-wins.
  - **A16** Editing is **reachable from the display**: Ctrl/Cmd+click opens a tile's **placement** in
    `#/layout` plus an explicit edit mode for touch. *(Both replaced by A43–A50.)*
  - **A17** The whole document shape is fixed by this spec, so P2/P3 add UI without another migration.
  - Types: `Placement { id, device, title?, tile? }`, `TileConfig { template?, size?, slots?,
    modal? }`, `Group.appearance`, `Group.tiles`, `Slot.from`.
  - Model rules: order is array order at every level (no `order` field); ids are unique in their
    parent and generated once; a placement with no `tile` renders from the chain; a deleted device
    leaves dangling placements that the renderer skips; an empty section renders nothing unless
    `showEmpty`; `member` is never written by P1 except by the migration and "add all matching";
    grouping stops at the section (a section holds only tiles).

## Layout editor — migratePageRegistry contract
- source: docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md
- type: api-contract
- content:
  - `migratePageRegistry(registry, devices) -> { registry, changed }`.
  - For every group without `tiles`: expand the current membership — the devices the **existing
    resolver** would show today, in that order (explicit `ids` claim a group first, then filter
    matches in registry order) — into `Placement[]` with fresh ids, leave `member` in place, set
    `registry.version = 1`, bump `updatedAt`.
  - **Idempotent**: a group that already has `tiles` is untouched; running it twice changes nothing.
  - **Non-destructive**: an unreadable/unparsable document is not migrated and not written; a document
    at `version >= 1` is passed through untouched.
  - Empty groups migrate to `tiles: []` (the editor shows them, the display hides them unless
    `showEmpty`).
  - The migration runs once, on load, where the registry is loaded today.

## Layout editor — interaction and reachability
- source: docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md
- type: protocol
- content:
  - Editor page `#/layout`: three areas on one screen, no tabs — tree (left), picker (opens over the
    tree), details (right) with a live preview rendered by the real components against live broker
    values.
  - The details pane edits a **draft that is the store**: edits apply to the in-memory registry
    immediately (preview and display update live) and are persisted debounced. Drafts are never
    destroyed by navigation.
  - Interactions: select (click; keyboard `↑`/`↓`, `Enter`); add page/section/tile (ids from
    `crypto.randomUUID()`, default titles); duplicate (page/section deep copy with fresh ids; tile
    same device + same `tile`); delete (confirm for page/section, immediate for a tile); reorder/move
    by drag with a drop indicator, plus move up/down in the node menu for touch; rename inline.
  - Reachability: the `sessionStorage` handoff (`iHome.edit`) is **retargeted** to `#/layout` with the
    placement selected; an **edit mode** toggle on the display bar (session-only, remembered in
    `__VISUAL__`) makes a tap open the placement and shows a pencil cue.
  - The display never writes the document; the editor is the only writer.
  - Error handling: unreadable document → keep the in-memory registry, write nothing, show a warning
    line; write failure → the debounced write retries once on the next change and the editor shows a
    "not saved" indicator; two tabs → last write wins; an invalid drop is refused with the indicator;
    a placement's unknown device is marked in the tree and skipped by the renderer.

## Tile editor — materialisation contract (A18)
- source: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md
- type: api-contract
- content:
  - **A18** A tile is **materialised iff it has `slots`**: the first edit of any tile-config field
    (size, background, slot, rule, apply template) writes a **complete** `{template, size, slots}` —
    the ledger's partial-`size` contradiction ends here. **Reset** drops `tile`. Legacy/partial tiles
    keep resolving from the chain (no migration).
  - `materialiseTile(device, templates)` → `{ template, size, slots }`, where `slots` is the resolved
    slot list (preset → template → device, frozen) and `template` records
    `device.template ?? presetForType(device.type).id`.
  - Every tile-config op goes through `ensureTile` first (size and background included); placement
    fields (`title`, `newLine`, `device`) never materialise.
  - Reset removes `tile` entirely (no empty object left behind); a legacy partial `tile` (e.g. only
    `size`) renders as today and the pane offers the first materialising edit.
  - Dormancy is data, not deletion; templates are deep copies both ways (A27 — no shared nested
    references); raw-state slots are read-only (no writes, no history kinds).
  - **Size is never adjusted automatically**: adding slots does not cap or resize the tile.

## Tile editor — model additions (A22/A23/A30/A34/A71)
- source: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md
- type: schema
- content:
  - `TileConfig` gains `background?: Background`, `active?: ActiveCondition`, and later
    `look?: { active?: StateLook; inactive?: StateLook }` (A71, 2026-10-21) with
    `StateLook = { glow?, color?, glyph?, background? }`; `Template` gains `background?`;
    `Slot` gains `showWhen?: "active" | "inactive"` (absent = both) and
    `where?: "tile" | "both" | "modal"` (absent = tile).
  - **A34** (supersedes the reserved `TileConfig.modal`, now deleted): a slot declares where it lives
    with `where`; badges and the chart layer can live in the modal too; the editor presents the three
    states as a tri-state icon button in the slot row before the move arrows
    (`crop_square` = tile, `splitscreen` = both, `open_in_full` = modal), cycling
    tile → both → modal → tile and skipping "modal" while it is the only slot left; `setSlotWhere`
    refuses to leave no slot on the main tile. The modal renders slots with `where ≠ "tile"` through
    the same `SlotRenderer`, opens only when at least one resolves into it, shows the tile's name with
    badge chips on the title line, and paints the tile's background.
  - **A22/A32** The tile background is `TileConfig.background` (`Background` reused, `backgroundCss`
    renders it) for solid/gradient/image; the chart background is a `sparkline` slot with
    `options.background: true` — **A32** renders it *over* the tile's content at `z-index: 1`
    (badges keep z 2, `pointer-events: none`), stretched to the tile
    (`preserveAspectRatio="none"`), centred at 70% of the tile's height, stroke 1.5px
    (`non-scaling-stroke`); in-body sparklines keep the 120:28 aspect.
  - **A23** Icons stay one raw string; `Icon` renders `<img>` for image-shaped values (URL, `data:`,
    absolute or broker-relative path) and the symbol span otherwise; `iconUrl()` resolves
    broker-relative values at render. The picker offers material symbols (bundled names list), icons
    used in this document, every `common.icon` from loaded objects/enums, and a URL field.
    **No upload / data-URLs.**
  - **A28** One shared `BackgroundEditor` serves pages and sections (kind select; solid → colour input;
    gradient → two colours + angle; image → URL); a value that does not match the structured shape
    falls back to a raw text field so hand-written CSS stays editable.
  - **A30** A tile carries an **active condition** `TileConfig.active = {source, op, value?}` with
    `ActiveOp = truthy | gt | gte | lt | lte | eq | ne` (numeric when both sides read as numbers, else
    case-insensitive equality). Its live result is the tile's **active** flag: a `.active` class
    (default look: the accent border), an `active` local available to every rule on the tile, and
    `Slot.showWhen` for per-slot visibility. A tile with no condition is never active.
  - **A71** `TileConfig.look` — a field set here wins over the rules for that state; an absent field
    keeps what the rules resolved; the **inactive look is also the tile's default** (a tile that never
    becomes active wears it). `glow` glows in that colour (`--tile-glow-color`; the border keeps the
    accent), `color`/`glyph` replace the headline icon's colour/glyph, `background` is painted last
    with `backgroundCss`. Dimming (`disabled`) stays rule territory.
  - `options.pick` = a curated hint or **any free text** matched case-insensitively against role, then
    label, then unit; `options.background: true` = the background chart; `options.index` /
    `options.position` / `options.of` / `options.from` keep their roles.

## Tile editor — slot resolution semantics (A20/A21/A31/A35/A36/A37/A38/A39)
- source: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md
- type: api-contract
- content:
  - **A20** Placeholder resolution: with a `source` → resolve to control or state; without a source and
    **without** a hint → positional fallback; without a source **with** a hint → resolve by
    role → label → unit; **no match → dormant** (renders nothing, stays in the config), never a
    positional stand-in. Dormancy resolves at render time (a bound control or a new device control
    brings it alive).
  - **A21** A `source` naming an existing **state object** (not a device control) resolves to a
    control-shaped **read-only** pseudo-control (value/unit/label from the object, no write semantics,
    no history spec); kinds offered for raw states: value, icon, badge; the pages store registers such
    sources as used state ids so they are subscribed.
  - **A31** A rule may carry **`only: true`** — a visibility gate rather than a style. While at least
    one gate is present and none matches, the slot hides; the verdict applies **after** the
    last-match-wins fold, so a later `hidden: false` cannot reopen it, and a broken gate expression
    **fails closed**. Badge slots honour `hidden`/`only` exactly like body slots.
  - **A35** **Slots are keyed by position, never by content**: two identical slots are legal config and
    render as two rows; the display must never merge them or crash on them (a duplicated
    `{kind:"value", source:"temperature"}` threw Svelte's `each_key_duplicate` and took the layout pane
    down). The headline reading is the first value **row**.
  - **A36** **A source names one control, and an icon spends none.** The slot picker writes a control's
    *feature* only while it is unique on the device, else the control's **id** (`sourceForControl`);
    an icon slot reads a control without consuming it (its source only feeds its colour and rules), so
    a readout is never starved.
  - **A37** A slot row names what the slot reads — the control under the device's own name for it
    (`label`, else `feature`); a raw state keeps its state id; a hint shows the control it resolves to
    now and carries a muted **"(hint)"** marker; the slot's own name stays the **Label** field;
    picking a Source **drops the slot's hint** (`setSlotSource`).
  - **A38** **A frame is a slot, and it reads a page, not a control**: `kind: "frame"` with
    `options.url` shows any web page in an `<iframe>`. The resolver walks it through **without a
    control** (it neither claims the next free control nor goes dormant). On the tile it fills the body
    under the tile's name (full width, grows into the leftover height); in the modal it takes the
    panel's whole width with no label column, tall as `--panel-max` (70vh in the dialog, 30vh in the
    pane preview). Editing: a **URL** field where a control slot has its Source; the slot picker gained
    a **"Web page"** tab. **No sandbox attribute** (these pages need their own scripts and storage and
    live on their own origin).
  - **A39** **A frame can be told to ignore the pointer**: `options.inert` puts `pointer-events: none`
    on the iframe, so presses fall through (the tile keeps its long-press, the modal its gestures);
    per slot, default off, ticked as **"ignore pointer"**.
  - **A40/A42** (tree behaviours, later superseded by the layout sheet) and **A41** (a tile can have
    **no name**: `title` absent → the device's name, a string → that name, `""` → no name line at all;
    the pane's "no name" checkbox writes `""`).
  - **A33** The tile's painted background renders: `Tile.svelte` puts `backgroundCss(tile.background)`
    on the tile element ahead of a rule's `background`, so the live condition still wins.
  - **A19** Templates are authored **from a tile** and applied **from the tile pane**: save writes a
    per-type template (size + slots + CSS background; features copied from the resolved template);
    apply **replaces** size + slots + background after a confirm; same name+type overwrites after a
    confirm; the **title stays per-placement**. The first save writes `templateList` (version 1); no
    proactive seeding, and an unreadable document disables saving.
  - **A25/A26** The tile pane's device row gets *Change…* (single-pick DevicePicker); changing the
    device drops the materialised `tile` after a confirm (title and new-line survive). *Move to
    section…* appends at the end of the target section; the tree's ↑↓ refines position afterwards.

## Tile editor — error handling
- source: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md
- type: nfr
- content:
  - Slot source resolves to nothing → dormant; the pane marks it and offers bind/remove.
  - The active condition's source resolves to nothing → the tile is not active; the pane marks the
    condition.
  - A state id stops existing → the slot goes dormant (render checks object/state presence).
  - `templateList` unreadable (present but unparsable) → **saving is refused**, a visible note in the
    pane, the document is never overwritten (same rule as `pageList`); absent → writable, the first
    save creates it at `version: 1`; a failed template write shows "templates not saved" and the
    registry stays in memory.
  - Icon URL 404 → the `<img>` breaks visibly; the picker showed the image before choosing; the value
    stays raw and fixable.
  - Device change with a materialised tile → confirm says the layout resets.
  - Non-goals: the `/templates` library page, template delete/rename UI, template inheritance editing,
    the device-form `template` field, active conditions inside templates, section member/filter
    builder, icon upload, history kinds on raw-state slots, drag-and-drop, the I11 accessibility slice,
    undo/redo, packaging.

## Layout sheet — the editor as a mode of the display (A43–A50)
- source: docs/superpowers/specs/2026-10-18-ihome-layout-sheet-design.md
- type: protocol
- content:
  - **A43** The editor is a **mode of the display, not a route**: `#/` stays the URL; the sheet is a
    component the display route renders when its open flag is set, so entering the editor navigates
    nowhere, the app bar keeps the page tabs, and the display behind is the *same* instance. The app
    bar's icon is the mode indicator (pencil opens, eye closes). The open flag is module state, so a
    reload comes back to the display; the **cursor** travels as a handoff because it crosses
    navigations. Wide screens: right-hand sheet (the display is inset and reflows); `≤820px`: bottom
    sheet (62 vh). The display stays **inert** (`pointer-events: none`) except A48's selection layer.
    The layout route, its app bar tab and the two handoff navigations are gone.
  - **A44** Three layout lines, no list: page (selector + settings fold-out + add + delete), section
    (selector + settings fold-out + add + duplicate + delete), tile (selector + add + duplicate +
    move up/down + remove). The tile's editor sits below the tile line; page/section fields sit behind
    `tune` fold-outs, closed by default. A tile's option label carries `name · w×h`. No
    insert-at-position: a tile is added at the end and moved with ↑/↓.
  - **A45** **One cursor, page included**: `pageId`/`sectionId`/`tileId`; the editor's `selection`
    derives from it. Every fallback is defined (missing/deleted page → the first page, section → the
    page's first, tile → the section's first). **The cursor's page is the display's page** — picking a
    page in the sheet switches the display and the app bar tab, and vice versa.
  - **A46** **The display is the preview**: A33's docked preview and A34's modal preview both retire;
    `PageView` takes its breakpoint from **its own container**, not the window.
  - **A47** **The detail page is a non-modal dialog over the display**: a **Detail Page** checkbox on
    the tile editor's heading line; the sheet renders its own hidden `Tile` and asks it for the dialog
    in its **non-modal** form (`show()`, not `showModal()`), positioned over the display; closing is
    unmounting (untick the box or use the dialog's close). The checkbox is always present and
    **disabled with a tooltip when the tile has nothing in the detail page**, asked of the same
    resolution the tile uses.
  - **A48** **Clicking a tile in the display selects it**: a transparent selection layer covers the
    stage and turns a click into the placement beneath it
    (`elementsFromPoint` → the tile's `data-placement-id`), then sets the cursor; the display's own
    gestures never fire in the editor.
  - **A49** The tile editor's own length is not part of this pass (its field groups stay expanded).
  - **A50** **A Device line, and one editor at a time**: the tile editor's DEVICE row becomes the
    fourth line — the tile's device from a plain **selector** (picking another device *is* the
    change-device action; the rich `DevicePicker` stays for adding tiles; a tile carrying its own
    config asks first), plus **add** and **delete** (a confirm that says the consequence: tiles that
    used it keep their place and show nothing until they get another device) and a switch that swaps
    the sheet's body between the tile's layout and the tile's device (the same `DeviceForm` the devices
    page renders). The mode is part of the cursor and resets to the tile when the tile changes.
  - Retires: `LayoutTree.svelte` and its fold rules (A40, A42), the route's two-column grid and the
    tree's sticky scroll, the layout route/tab/handoff navigations, A33/A34 previews, the `focus`
    handoff split (a handoff is only "set the cursor"), the tile editor's DEVICE row and its trip to
    `#/devices`.
  - Tests named: cursor fallbacks, the tile line's `name · w×h` label, the modal-parts helper
    (a slot in `modal`/`both` counts, a `tile` slot does not, a rule-hidden slot does not), the stage's
    click mapping, the change-device guard. Component behaviour is verified in the browser.
  - Open question carried: with no list, ↑/↓ are the only way to position a tile and its position is
    invisible — keep them, or show the position on the line (`3 / 7`)?

## Slot icons — the SlotIcon descriptor (A51–A54, A57, A58, A70)
- source: docs/superpowers/specs/2026-10-19-ihome-slot-icons-design.md
- type: api-contract
- content:
  - **A51** A slot can carry an icon: `Slot.icon?: SlotIcon` with
    `SlotIcon = { glyph?: string; enabled?: boolean; where?: "tile" | "both" | "modal" }`. No
    descriptor → no icon; `enabled: false` keeps glyph and rules but renders nothing. The icon has
    **no placeholder**: glyph = last matching rule's `icon`, else `icon.glyph`, else nothing (the
    legacy `device.icon`/`widgets` fallbacks do not apply). The slot's **own rules dress the icon**
    (`icon` swaps the glyph; `color`/`glow`/`disabled` style it); a rule icon on a slot whose icon is
    not enabled stays dormant.
  - **A52** **The headline slot is the tile's face**: headline = the first `value` slot of the tile's
    slot list (config order), else the first slot. When its icon is enabled and its `where` allows the
    detail home, that icon renders in front of the tile's name on the detail page. Its resolved style
    drives the tile accent/glow/background — independent of whether its icon is enabled (so "glow when
    on" keeps working icon-less).
  - **A53** The icon renders with its slot, wrapping: icon + content as one cluster (icon left when the
    line fits, above it when not — pure CSS flex-wrap, no config). The headline icon keeps the large
    glyph (34 px), every other slot icon sits at reading size (~17 px). "Fits" is device-dependent, so
    the **primary (headline) cluster is deterministic**: at a 1-wide rendered span it stacks, from w=2
    it sits side by side, still wrapping when the text is long. Secondary icons stay inline. No icon →
    no space reserved; a dormant slot renders nothing, so its icon comes alive with the slot.
  - **A54** The detail page: the icon moves to the name; rows read **icon → name → value**. Home rule:
    an icon renders where its slot renders **and** its own `where` allows it (absent = `both`); the
    header is the one place a `modal`/`both` headline icon shows even when its slot itself lives only
    on the tile; a `tile`-only headline icon does not greet the name. The slot's own visibility
    (`showWhen`, `hidden`/`only`) always wins for rows; the header follows the icon's own
    `enabled`/`where` only. Frame slots: their icon precedes the frame block.
  - **A57** Editor: one **Icon block** per slot (between the hint/knobs rows and the rules block) — an
    icon toggle (`enabled`), a glyph control that shows the current glyph or "Choose glyph…" and opens
    the existing `IconPicker`, and the icon's `where` as the same tri-state control the slot uses
    (default *both*; choices that can never render are disabled). The block is offered on the
    data-bearing kinds (`value`, `level`, `color`, `enum`, `button`); the renderer stays generic. The
    collapsed row shows a tiny glyph preview; the headline slot carries a **headline** tag.
  - **A58** **One rules list per slot** — there is no icon-specific rules UI: the slot's rules *are*
    the icon's rules.
  - **A70** **A glyph you pick wins** (2026-10-21): choosing a glyph in the Icon block's picker also
    drops the glyph from that slot's rules (`clearRuleIcons`), because a rule's `icon` outranks the
    descriptor; clearing the descriptor leaves the rules alone.
  - Model rules: presence gates rendering; glyph chain = last matching rule's `icon` → `icon.glyph` →
    nothing; homes = tile cluster iff the slot renders on the tile ∧ `where ∈ {tile, both}`, modal row
    likewise for `{modal, both}`, header iff the headline icon is enabled ∧ `where ∈ {modal, both}`;
    dormant slots render nothing; **accent source** = the first legacy icon slot while one exists,
    otherwise the headline slot's resolved style (enabling/disabling an icon never changes the accent).
  - Error handling: broken URL → the `<img>` breaks visibly; enabled with no glyph → nothing renders,
    the editor shows "no glyph yet"; conversion target already has an icon → overwritten after the
    confirm says so; conversion target missing → action disabled with a tooltip; a converted icon
    slot's `showWhen` is not carried (the confirm says the icon will follow the target's visibility);
    unreadable document → saving stays disabled.

## Slot icons — legacy icon-slot retirement (A55/A56)
- source: docs/superpowers/specs/2026-10-19-ihome-slot-icons-design.md
- type: api-contract
- content:
  - **A55** Presets are re-authored; the fold is mechanical: each preset's `icon(source, glyph, rules)`
    entry folds into the slot carrying the same source (`icon: { glyph }` + the icon slot's rules
    appended **after** that slot's existing rules, last match wins); the fallback target is the
    headline slot (needed for hint-based presets: Thermometer's icon folds onto its first value slot,
    Value's onto its bare value). A **preset-integrity test** pins the mapping. Unmaterialised tiles
    adopt the new look on ship: 1×1 tiles look unchanged, wide ones (Thermostat, Blind, AC) put the
    icon beside the reading — the intended change.
  - **A56** Legacy `kind: "icon"` slots were **retired on 2026-10-20**: `IconSlot`, the renderer
    branch, the fold operations and the editor affordances are gone, and there is **no load-time
    migration** — a document that still carried an icon slot would render nothing (the live document
    carries none; the fold was done one-off, 7 slots across 7 tiles).
  - Conversion (`foldIconSlot(tile, iconSlotIndex)`) was pure and a no-op when there was nothing to
    fold; `patchIcon` never leaves an empty `{}` descriptor behind.
  - Risks stated: wide unmaterialised tiles change look (intended, previewed); two mechanisms coexisted
    until conversion; previously inert rule styles become visible only after a descriptor is added.

## Slot sparklines — the SlotSpark descriptor (A59–A63)
- source: docs/superpowers/specs/2026-10-20-ihome-slot-sparklines-design.md
- type: api-contract
- content:
  - **A59** **The chart is a property of the value slot**: `Slot.spark = { enabled?, where?, color? }` —
    no descriptor, no chart; `enabled: false` keeps colour and home but draws nothing; `where` is the
    chart's own home, absent = `both`. `kind: "sparkline"` and `SparklineSlot.svelte` retire, together
    with the sparkline-only `options.background` flag and `tileParts`' `background` row list. New
    configuration never creates a chart slot (the `+` picker and the kind select no longer offer one).
  - **A60** **The chart's home is its own** — not narrowed by the slot's `where` (a value whose row
    lives only in the modal can still feed the tile's chart; `spark.where: "tile"` on a modal-only row
    draws on the tile and nowhere else). It *is* resolved from the tile's **visible** rows: a
    rule-hidden row, or a slot whose `showWhen` excludes the state, takes its chart with it, and the
    palette order follows that resolved list. The deliberate difference from the icon (A51/A54).
  - **A61** The tile's chart keeps its geometry (absolutely positioned, centred in the tile,
    `pointer-events: none`, no space reserved) and draws **every** value slot whose spark is not
    disabled, whose home allows `tile`, and whose resolved control has history, **in slot order**.
    Colour = `spark.color`, else the palette colour at that slot's index among the tile's
    chart-enabled values (whatever their home), in slot order, so a value keeps its colour between the
    tile and the detail. Palette order: `--primary-color`, `--success-color`, `--warning-color`,
    `--danger-color`, `--secondary-color`. Each series is normalised to its own min/max; a constant
    series draws the flat centre line. **x is time, not index**: each series is placed by its own
    timestamps across the widest window of the charted specs. Nothing is drawn until the first sample
    arrives — no placeholder glyph, no reserved space. **No legend on the tile.**
  - **A62** **The row's chart**: in the detail page a value row reads **label → chart → value**; a
    middle cell grows into the free space and holds the chart (~24 px high, full width of the cell);
    the value stays right-aligned and no longer takes the growing column while a chart is present.
    Rows without a chart are unchanged, pixel for pixel. The row chart is row content: it obeys the
    row's visibility and needs no second `where`.
  - **A63** **Value slots only; the renderer stays generic.** The editor offers the Sparkline block on
    `value` slots only, but the renderer draws any descriptor it finds whose control can chart. A
    control can chart when it has a `history` spec **and** a `stateId`; otherwise nothing is drawn
    (the tile silently omits the series, the row omits the chart) and the editor disables the toggle
    with a hint pointing at the device editor.
  - Model rules: presence of `spark` is the switch; colour is one raw CSS colour or theme token; the
    spark does not change the slot's reading, layout or rules. `tile-parts` gains `hasHistory`,
    `tileSeries`, `rowSpark`, `CHART_PALETTE` and exposes `rows`; `history-ops` gains
    `seriesPoints(series, {from, to, width, height, pad})` (time-mapped; `sparklinePoints` stays for
    the device editor's previews); `patchSpark` mirrors `patchIcon` (never leaves `{}`).
  - Editor: the tile-level chart dropdown (`chartSources`, `currentChart`, `setChart`, the "at most one
    background sparkline" rule) goes; the Sparkline block arrives (toggle, colour with an **Auto**
    state, the same tri-state `where`), disabled with the hint *"no history for this control —
    configure it in the device editor"*; the collapsed row shows a `show_chart` marker.
  - Non-goals: a tile legend/colour ticks/labels, axes/tooltips/zoom/crosshair, sparklines on badge/
    frame/level/colour/enum/button slots, any change to `history-list` or to how history is
    configured, new charts in the presets, a chart on an unmaterialised tile.

## Slot sparklines — kind retirement and the one-off migration (A64)
- source: docs/superpowers/specs/2026-10-20-ihome-slot-sparklines-design.md
- type: api-contract
- content:
  - **A64** Migration is a one-off, **before the code lands** (the A56 pattern, deliberate and
    approved): for every `kind: "sparkline"` slot, resolve its `source` against the tile's device
    controls; the first `value` slot on that tile resolving to the same control gets
    `spark = { enabled: true, where: "tile" }`; with no such row, a `value` slot is inserted for the
    chart's control with the source preserved and `where: "modal"` (the tile is visually unchanged,
    the detail gains the reading) plus the same spark; the sparkline slot is then removed.
  - The write goes through the app's store (`commitLayout`), `updatedAt` is bumped, and the document is
    read back and verified before the retirement commit.
  - Five live charts, all background charts, none in an unmaterialised tile (the presets carry none):
    Rooms/Bad thermometer (`temperature`), Home/Klima thermometer (`temperature`), Garten-Pool Light
    (`power`), Wohn-Ess-Z Brunnen (`value`, watts) and Home/Klima Brunnen (`value`, watts) — the last
    two had no matching value row.
  - **Amended after the fact**: the two Brunnen sources carry **no history**, so their old sparkline
    slots drew nothing; the two inserted modal-only rows were **reverted** — those tiles render exactly
    as before, and the user re-adds a chart by configuring history and enabling the toggle.
  - `SlotKind` loses `"sparkline"`; `options.background` is no longer a documented option;
    `history-list` is untouched.

## Device icons — resolution from the broker hierarchy (A65/A68)
- source: docs/superpowers/specs/2026-10-21-ihome-device-icons-design.md
- type: api-contract
- content:
  - **A65** The device icon comes from the broker hierarchy. The document's `Device.icon` wins when
    set. Otherwise the device's controls are walked **in control order**: for each, its `stateId` is
    walked upward (`a.b.c.d` → `a.b.c` → `a.b` → `a`) and the **first object carrying any of
    `modelIcon`, `extIcon`, `icon` — tried in that order on that object** — wins (nearest object
    first: a channel's inline SVG beats an `extIcon` further up). With nothing found, the adapter:
    `system.adapter.<adapter>.<instance>` then `system.adapter.<adapter>`, where
    `<adapter>.<instance>` are the first two segments of the originating id — **per control**: the
    first control that needs the fallback uses its own adapter. Nothing found → no icon, and the
    device renders as it does today.
  - Resolved once, in the device enrichment, as `EnrichedDevice.objectIcon` (**A68**): a handful of
    `Map` lookups per control inside the existing enrichment (recomputed when the device list or the
    object cache changes) — no network, no per-render walk, no new cache; `objectIcon` is stored
    **already resolved to a URL**, so components render it as an opaque string.
  - `objectIcon` is presentation only: it never enters the page/template documents, so an adapter's
    icon update shows up without touching a document.
  - **A67 (placement)** It is the **tile's main icon**: the headline slot's glyph when that glyph is
    the *template's own* (a slot position whose chain slot carries the same kind and glyph — a type
    default, not a choice), and the detail page's header follows the same resolution. A rule's `icon`
    still swaps it and a glyph the user chose still stands; with no found icon the template's glyph
    stays. It also shows on every **device row in the devices page** and in the icon-capable pickers
    (the sheet's device picker, the devices filter). The tile's **name line deliberately carries no
    icon**; a native `<select>` cannot show images, so the tile pane's device dropdown stays text-only.

## Device icons — the iconSrc URL contract (A66/A69)
- source: docs/superpowers/specs/2026-10-21-ihome-device-icons-design.md
- type: api-contract
- content:
  - **A66** `iconSrc(raw, owner?)` replaces the `/`-prefixing `iconUrl`: `data:`, `http(s)://` and
    protocol-relative values pass through; a leading `/` is **ioBroker-root-relative** — rebased onto
    the base for a value taken from a broker object, left alone for a value typed into the document;
    `adapter/…` → `<base>/adapter/…`; a bare filename → `<base>/adapter/<owner>/<file>` when the owner
    (adapter) is known, else `<base>/<file>`. The base is `http(s)://<hostPort>` from the footer
    setting (the same value the socket URL uses), falling back to `location.origin`.
  - `Icon.svelte` becomes the **single image renderer**: `EnumBadge.svelte` and `MultiSelect.svelte`
    drop their hand-rolled `isUrl` (which treats a bare filename like `energiefluss.png` as a symbol
    name, so it is invisible, and resolves anything path-like against the app's origin, so room/
    function badges 404 on the same values). Symbol names stay symbols (`isImageIcon`).
  - **What the picker stores**: picking from the Broker tab writes `brokerIconPath(value, ownerId)` —
    the portable `adapter/<adapter>/<file>` form — so the icon keeps rendering after a host change and
    resolves without an owner; the previews render with the owner,
    `Icon value={entry.value} owner={entry.id}`.
  - **A 404 renders nothing**: the renderer drops an image whose load failed rather than showing a
    broken-image glyph.
  - **A69 (limits)** A relative value on an object with no adapter to own it (`enum.*`, `0_userdata.*`)
    is tried at `/adapter/<first-segment>/…` and may 404; an icon that 404s renders nothing; the
    picker's Broker tab keeps listing `common.icon` values (it does not gain `modelIcon`/`extIcon`
    entries — the automatic device fallback is what uses those); nothing is written into the document
    by this change.
  - Non-goals: automatic icons for value slots (slots keep what they are configured with), a
    per-control/per-channel icon picker section, writing resolved icons into the documents,
    `getObjectView`/enum icon resolution beyond the shared renderer fix, retrying a 404 against other
    candidate paths or a placeholder for a missing icon.
