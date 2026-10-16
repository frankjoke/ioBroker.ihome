# Handoff — 2026-10-16-b — iobroker-visual-adapter

Previous handoff: `handoff-2026-10-16-iobroker-visual-adapter.md` (P1 review + fix pass, layout-editor
polish). This session built the **P2 tile editor** end to end: spec (`83ef1a7`), A30 amendment
(`a40fe4e`), plan (`c7f59b7`), then tasks 1–18 of
`docs/superpowers/plans/2026-10-16-ihome-tile-editor.md`, executed inline task-by-task with a ledger
(`.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md` — rulings, per-task commits, live-check
notes).

---

## 1. Where we are

- Branch `feature/ihome-display` at **`dc1286f`**, working tree clean (handoff commit follows). No
  remote, nothing pushed, nothing merged.
- **All gates green:** `npm run check` 0/0, `npm test` **310 passed** (27 files), `npm run lint` 0,
  `npm run build` writes `www/`. `graphify update .` refreshed `graphify-out/` (1179 nodes, 2880 edges).
- Live broker `192.168.178.9` (admin 8081, web.0 8082): document **2 pages / 32 sections / 16
  placements / version 1**, still valid JSON; `templateList` still absent (first save writes version 1).
  No broker write happened this session (checks were read-only via the MCP).
- **One live tile is materialised** — the Brunnen on `rooms/room:enum.rooms.Wohn-Ess-Z`, with a
  **legacy partial `tile: { size: { w: 2, h: 1 } }`** (user-side size edit from the old editor; the
  document's `updatedAt` moved during the session). It is user data — do not rewrite it by hand; it is
  the natural criterion-4 target in the end pass.

## 2. What landed (17 commits, `234cc4f..dc1286f`)

Pure core (all TDD'd, 310 tests):

| commit | what |
| --- | --- |
| `234cc4f` | `TileConfig` model + `materialiseTile`/`ensureTile`/`resetTile` (A18) |
| `0a55557` | slot/rule ops + the single `editTile` write path |
| `a6edef9` | one slot-resolution pass: hints, dormancy, state visibility (`pickSlotControls`, `slotVisible`, `pickable`) |
| `a98f6ea` | `evalActive` — the tile's active condition over live values (A30) |
| `516f3be` | per-type templates: `templateFromTile`/`upsertTemplate`/`applyTemplate` + the writable template store |
| `07d5ec3` | `isImageIcon`/`iconUrl`/`collectDocumentIcons` + `Icon.svelte` |
| `134dc06` | gradient builder + inspector (`gradientValue`/`inspectGradient`/`isHexColor`) |
| `65f4e37` | one handoff protocol (`requestLayoutConfig`/`takeRequestedLayout`/`parseLayoutRef`) (A24) |

Display (T9–T11) and editor (T12–T17):

| commit | what |
| --- | --- |
| `84e8e5f` | tiles render their own slots, raw states, dormancy (A20/A21) |
| `c2f7753` | tile active state, chart background layer, image icons (A30/A22) |
| `1b969ae` | Ctrl/Cmd+click a section/page opens the editor on it; stale page tab resolves (A24/A29) |
| `a2967a1` | `IconPicker` — symbols, document icons, broker icons, URLs (A23) |
| `535960d` | `BackgroundEditor` — colour/gradient/image for pages, sections, tiles (A22/A28) |
| `3fdd08a` | `SlotPicker` — this device / placeholder / any state + tile-row `+` (A21) |
| `f802a39` | tree folds to the handoff target; real icons in the tree (A24) |
| `63468d1` | tile pane part 1 — background, chart, Active when, size via `editTile`, templates, device swap, move-to-section (A19/A25/A26) |
| `dc1286f` | tile pane part 2 — slot list + per-slot rules with live dots (A20/A30) |

Ledger rulings worth knowing (full list in the ledger): gradient builder only when both stops are hex
(named-colour gradients stay raw, never destroyed); `SlotPicker` has modes `slot`/`source`; the pane's
active-source picker is pane-owned, the device-swap picker route-owned; `onAddSlot`/`onSwapDevice`
props were added to `LayoutDetails` beyond the plan's Interfaces list; chart slots are
`{kind:"sparkline", source, options:{background:true}}` (no dead `options.source`); "copied from
<name>" only for user templates.

## 3. Live checks done this session (document level, iobroker MCP)

- T9: 2 pages / 32 sections / 16 placements, no `tile` keys then; `templateList` absent.
- T13: 3 live section backgrounds — `{solid, ""}` (Bad, Garten-Pool), `{solid, "#789"}` (Umwelt);
  `isHexColor("#789")` true, `backgroundCss` renders all three. No hand-written gradient live.
- T14: pump = `461682f3…` (Switch) with controls `power` + 2× `value` → the "This device → power"
  target.
- T17: no live device carries `slots` or slot rules → every live tile lists chain/preset slots.
- T18: document parses, display path intact; the Brunnen legacy partial tile above.

## 4. Deferred to the user's browser pass (Ruling P2 — no browser tool in this harness)

Walk the spec's criteria 1–8 against the real broker:

1. `+` from the tile row and the pane's **Add slot…**: device control, placeholder (dormant on a
   device without that reading — all live Thermometers have humidity, use e.g. a "pressure" hint on
   one), any state; display updates live.
2. Slot rows: expand, edit kind/source/label/unit/knobs; rules editor — `when` live dot, icon,
   colour, glow/hidden/disabled, background, tone, reorder (last match wins).
3. **Save as template** → `templateList` appears at **version 1**; apply on another same-type tile
   (title/active survive); save the same name again → replace confirm (same id).
4. First edit of the Brunnen tile materialises (`tile.slots` appears) **keeping w:2 h:1**; Reset
   returns it to the chain (confirm text says so). Do this on a copy/another tile if you want the
   live partial preserved.
5. Page/section backgrounds via colour picker + gradient builder (two colours + angle → preview and
   display); icons via the picker (symbols search "bolt", document icons, broker list — broker
   `common.icon` values are bare filenames like `web.svg`, stored as-is per A23).
6. Slot `+` offers only the tile's own device controls or any state; raw states render read-only and
   update live.
7. Unmaterialised + legacy-partial tiles render exactly as before; hand-corrupt `templateList` /
   `pageList` via admin → the editor refuses to overwrite and says so (restore after).
8. Brunnen: add the power badge, "only active", Active when = its switch → badge only while running;
   rule `when: "active"` → icon `flash_on` on the icon slot; delete the active condition → the pane's
   "no active condition set" note appears.
9. T11/T12/T13 leftovers: Ctrl/Cmd+click section header/page tab folds the tree to that node; delete
   the shown page then reload → first tab highlighted (A29); picker Clear/previews.
10. Pencil: view a page → click the pencil → the tree folds every other page and shows the viewed
    page's sections (Ctrl/Cmd+click a tab keeps the same behaviour).
11. Badges: two badges on one tile with no position → top-right + bottom-right (a third → top-left,
    a fourth → bottom-left); set one explicitly to bottom-left → the auto ones skip it; the tile body
    must not shift when badges appear/disappear (A30-hidden one drops out); the badge may hang onto
    the border/glow (tune `--out` in `BadgeRow.svelte` if it should sit further in/out).
12. Badge colour: pick a theme name (it must follow the dark toggle), then "custom…" → picker; a rule
    tone ("battery < 20% → warn") must override the static colour, and a rule colour must override
    both; two badge slots with the same x/y and mutually-exclusive `hidden` rules → each shows in
    that spot.
13. Device round trip: in a tile's pane, "Edit device…" → the device form opens on that device; add
    or remove a control and save; "Back to the tile" → the layout editor folds to the same tile and
    the pane shows the updated device (a slot on a removed control goes dormant). From the display's
    Ctrl/Cmd+click the button must be absent.
14. Value slots: the `unit` checkbox in the value knobs drops the unit ("21.5" instead of "21.5 °C",
    booleans keep OFF/ON); the main value must read noticeably bolder than the tile title in both
    themes, secondary readings stay light.
15. Value-driven badge: on the bath badge slot, a rule `when: battery < 30` with ☑ only (and tone
    danger) → the badge appears only while the battery is low, in danger tone; at ≥ 30 it vanishes.
    ☑ hidden with the inverted condition (`battery >= 30`) must vanish too (before this commit it did
    nothing — badges dropped `hidden`). `only` gates any slot kind; the rule's live dot flags a broken
    gate (a broken gate hides the slot).
16. Precision: a value slot's `decimals` knob (e.g. 1) → humidity 54.32 shows "54.3"; 0 → "54";
    clearing the field restores the raw reading. Trailing zeros drop ("54", not "54.0"). Badge labels
    and slider/switch readouts still show full precision (the knob is value-row only).
17. Preview dock: open a tile's pane and scroll down to the slots → the tile example stays pinned at the
    bottom edge of the screen (dashed card with shadow); at the very end of the pane it settles into its
    natural spot. With no device assigned it is absent. The section pane's preview stays static.
18. List-end +'s: a page's first/last section row shows a + where the greyed arrow used to sit — it adds
    a section above/below; same on a section's first/last tile row (the device picker inserts the picked
    devices there) and on the pane's first/last slot row (the slot picker inserts there). Middle rows
    keep their working arrows. A page/section row's own + shows only while its list is empty; the tree
    tile's + (add slot) is gone — the pane's "Slots" label line carries the + instead (appends at the end).
    Page rows work the same (add a room above/below); the header + shows only while the tree is empty, and
    a new room arrives with one empty section.

Also verify before/after: **A20 changed live behaviour** — a failing hint no longer falls back
positionally; a slot whose hint does not resolve now goes dormant (nothing renders, rows do not
shift).

## 5. Deferred features (do not build here)

P3 modal slots + `Slot.from`; a `/templates` library page, template delete/rename, `basedOn` editing,
the device-form `template` field; section member/showEmpty/width hints; icon upload; drag-and-drop
(↑↓ stay); packaging/pushing; the I11 focus trap and tree keyboard contract (M1); the parked ThinkPad
items (Brunnen double-toggle — parked as device-side, its `[ihome-dbg]` tracing is now removed —
`main.js` literal logging, duplicate tile titles, unused `house-controller.svg`).

## 6. Follow-ups landed after the handoff (same day, user feedback while adopting)

Both committed; gates re-run over both: 310 tests (27 files), check 0/0, lint 0, build writes `www/`.

- **Pencil folds to the viewed page** (`a5b5aa5`): the pencil was a bare link — the editor kept
  whatever folding it had. It now hands over the current page (the same `requestLayoutConfig` path
  Ctrl/Cmd+click on a tab uses), so the editor opens folded to it: other pages folded, that page's
  section rows visible (sections stay folded; click one for its tiles).
- **Badges overlay the tile and fill the free corners** (`d9c32d3`): badges no longer reserve a 15px
  band (`has-top-badge`/`has-bottom-badge` gone) — they sit at `z-index: 2` and may cover a value.
  Position is now `options.x` (left/center/right) × `options.y` (top/middle/bottom), set with two
  selects in the pane's badge row; unpositioned badges fill the free corners top-right → bottom-right
  → top-left → bottom-left, skipping corners an explicit position claims, wrapping after four. The old
  kind-driven corners (`options.position`) are gone — nothing live or in presets used them. Anchors
  hang the badge out onto the border/glow (`--out: -8px` in `BadgeRow.svelte`).
- **Badge colour knob** (`e6ee836`): `options.color` takes a theme name (primary, secondary, text,
  muted, success, warning, danger — they follow light/dark) or a hex from the pane's picker.
  Precedence: matched rule colour > matched rule tone > slot colour > default tone. A badge rule's
  colour now works (it was resolved but never rendered); the derived ago/offline badges take the slot
  colour over their born tone. Two badges may share an explicit x/y spot (alarm/warning alternatives).
- **Device round trip** (`ca0dd0b`): the tile pane's "Edit device…" opens the device's form on the
  devices page and leaves the tile's address pending; the devices page shows "Back to the tile" when
  that address is pending (peek — the layout route still owns taking it). The editor reopens folded to
  the same tile with the device as it now is; the Layout tab resumes it too.
- **Optional unit + bolder main value** (`91dcc6c`): a value slot's `unit` checkbox drops the unit to
  save width (booleans keep their OFF/ON label); the main value is now JetBrains Mono 800 — heavier
  than the 600 title. Value slots only (badges/slider readouts unchanged for now).
- **Value-driven slot visibility** (`5ff6178`): a rule's `only` checkbox makes it a visibility gate —
  the slot (or badge) exists only while it matches; the verdict is applied after the last-match-wins
  fold, and a broken gate expression fails closed (spec A31). Badge slots now honour `hidden`/`only`
  exactly like body slots — their own rules and the control's, the derived ago/offline badges included;
  before, `controlBadge` computed `style.hidden` and dropped it, so no rule could ever hide a badge.
- **Value precision** (`0a34641`): the `decimals` knob now renders — the value slot rounds to it via
  `formatNumber` (numbers and numeric strings alike; trailing zeros drop; a cleared or junk knob leaves
  the reading alone). Badges and slider/switch readouts keep full precision for now.
- **Tile preview docks** (`c329143`): the tile pane's preview (its last block, rendered only with a
  device) is `position: sticky; bottom` — it floats at the bottom screen edge while you scroll anywhere
  above it, so slot edits stay in view, and settles at its natural spot at the end. The section preview
  stays static (a whole section is too tall to dock).
- **List-end +'s** (`d51c58c`): the disabled ↑/↓ on a list's top and bottom rows became the list's `+` —
  it adds above/below right where you clicked (sections per page, tiles per section, slots in the pane);
  middle rows keep working arrows. The old fixed +'s step back: a page/section row keeps its + only while
  its list is empty (no rows → no ends); the tree tile's + (add slot) is gone — the pane's "Add slot…"
  button is now a + on the Slots label line, right-aligned above the dustbins, appending at the end.
  `addSection`/`appendDevices` gained an optional insert index (`addSlot` already had one); the picker
  targets carry it through the route. Page rows work the same (`e5c6d1c`): the header + shows only while
  the tree is empty, and `addPage` now brings one empty section with the room — a room is never without
  a section.
- **Layout label moved into the rooms card** (`7a39e4c`): the page header's "Configuration / Layout"
  heading is gone; the small mono label now sits at the top of the tree card as "Layout configuration".
  The header renders only when it has something to show (a save/read badge, or the Add page button while
  the tree is empty) — otherwise the rooms list is the top of the page.
- **`[ihome-dbg]` tracing removed** (`17ee2af`): the double-toggle instrument is gone — `utils/dbg.ts`
  deleted, its pointer-trace callers (Tile, ValueSlot, IconSlot) and the toggle / stateChange console
  logs removed. The guarded `writeControl` calls stay; only the logging went.
- **Tighter app shell** (`a5a4a86`): `.app-main` padding 24px → 8px (the ≤768px override, same value,
  went with it) — every page's content starts 16px higher; the display shell (padding 0) is untouched.
- **Display page padding 8px** (`fabe19c`): the display's own page wrapper (`PageView` `.page`, 12px
  around the sections) matches the shell now.
- **Device actions as icons** (`d4b3b17`): the tile pane's "Change device…" / "Edit device…" buttons
  are icon buttons now — the `select` glyph (dashed selection box) and the pencil (`edit`); titles and
  aria-labels keep the words.
- **Bold device name** (`5358175`): the tile pane's Device field name is `<strong>` now — the tile's
  main device reads as the field's value; the Template source line keeps its weight.
- **Chart layer** (`d903fef`): background sparklines stretch to the tile (`preserveAspectRatio="none"`
  via a `stretch` prop; SlotRenderer sets it for `options.background`) and render *above* the content
  (`z-index: 1`; badges stay z 2). The drawing used to be letterboxed into an ~11px strip in the
  middle — hidden behind the icon and values. Spec A32 records it.
