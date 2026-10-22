## Conflict Detection Report

Docs compared: 22 (11 SPEC, 11 DOC). Mode: `new` — no existing `.planning/` context to merge against
(`EXISTING_CONTEXT` empty; `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` do not exist yet).
Precedence applied: `ADR > SPEC > PRD > DOC`. No doc carries a `precedence` override; **no doc is
marked `locked`**, so no LOCKED-vs-LOCKED or LOCKED-vs-existing-context check could trigger. No
classification is UNKNOWN.

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (11)

[INFO] Auto-resolved: breakpoint module sizes and clamp maxima (SPEC over DOC)
  Found: docs/superpowers/plans/2026-10-14-ihome-display.md states "Breakpoints and sizes are copied
  verbatim from the spec: phone `<600px` tile 150px max `1x2` · tablet `600–1024px` tile 170px max
  `2x2` · desktop `>1024px` tile 190px max `4x4`", and its Task 3 test asserts
  `[["phone", 150, 1, 2], ["tablet", 170, 2, 2], ["desktop", 190, 4, 4]]`.
  Note: docs/superpowers/specs/2026-10-14-ihome-display-design.md §5 (SPEC) fixes `--tile-w`/`--tile-h`
  at 45/90 (phone), 51/102 (tablet), 57/114 (desktop) with `--max-w`/`--max-h` 2/2, 4/3, 4/4, and A2
  calls the phone clamp (2×2) deliberate. The SPEC's numbers are the ones the implementation carries
  (`src/lib/config/size-ops.ts`: 45/90, 51/102, 57/114); the plan's 150/170/190 appear nowhere else in
  the ingested set. Synthesis used the SPEC table; the plan's line is a stale copy and should not be
  planned from.

[INFO] Auto-resolved: the device icon on the tile's name line (SPEC over DOC)
  Found: docs/superpowers/plans/2026-10-21-ihome-device-icons.md Task 4 step 1 says "the tile's name
  line renders `<Icon value={device.objectIcon} size={15} />` before the text when present (the name
  line becomes a flex row, the icon not shrinking)", and its live pass checks "Bad.Thermometer's inline
  SVG at the tile name".
  Note: docs/superpowers/specs/2026-10-21-ihome-device-icons-design.md A67 (SPEC) says the opposite —
  "The tile's **name line deliberately carries no icon** (the face is the tile's own, not a second
  badge)" — and its §5 puts the device icon on `bodyIcon`/`headIcon`/`modalRows` only. The shipped
  component follows the SPEC (the name line renders the tile name alone; `objectIcon` reaches the rows
  and the detail header). Synthesis used A67; the plan's step 1 is a draft that was not implemented.

[INFO] Declared deviation: formula templates — polling readable vs direct `$state` read
  Found: docs/superpowers/plans/2026-10-10-formula-templates.md ("Deviation from spec §5: the spec
  named a polling `formulaListStore` readable; the plan reads the module `$state` directly in
  `$derived` … which is reactive without a poll").
  Note: the plan states the deviation and its cost itself (a component reading the library outside a
  reactive context would not update — none do). No user decision needed; recorded so the two documents
  are not read as contradicting silently.

[INFO] Documented supersession: the slot vocabulary lost `icon` and `sparkline`, gained `frame`
  Found: docs/superpowers/specs/2026-10-14-ihome-display-design.md §4/§6 (SPEC) defines
  `SlotKind = icon | value | level | color | enum | button | badge | sparkline | history-list`.
  Note: later specs own the changes: A38 added `kind: "frame"` (tile-editor), A56 retired
  `kind: "icon"` (slot-icons, 2026-10-20, no load-time migration), A59 retired `kind: "sparkline"`
  (slot-sparklines). Effective vocabulary after synthesis: `value | level | color | enum | button |
  badge | history-list | frame`, which is what `src/lib/types/display.ts` carries. The earlier SPEC's
  union is superseded, not competing.

[INFO] Documented supersession: `TileConfig.modal` deleted in favour of `Slot.where`
  Found: docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md A10 (SPEC) reserves two
  surfaces, `slots` and `modal.slots`, and A17 fixes that shape "so P2/P3 add UI without another
  migration".
  Note: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md A34 (SPEC) states it "supersedes
  the reserved `TileConfig.modal`, now deleted" and replaces it with `Slot.where`
  (`tile`/`both`/`modal`), the automatic all-controls enlargement ending with it. Self-declared, so the
  later spec governs.

[INFO] Documented supersession: the chart layer's z-order (A22 → A32 → A61 wording)
  Found: docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md A32 (SPEC) renders the chart
  layer "over the tile's content at `z-index: 1` (badges keep z 2; `pointer-events: none`)".
  docs/superpowers/specs/2026-10-20-ihome-slot-sparklines-design.md A61 (SPEC) describes the same
  layer as "absolutely positioned **behind** the content".
  Note: A61 also claims the layer "keeps its geometry", so its "behind" is descriptive prose, not a
  new decision — A32 governs (it explicitly superseded A22's "drawn behind the content"). The shipped
  component is `z-index: 1` over the content, matching A32. Recorded as a wording defect in A61; a
  planner must not read it as a z-order requirement.

[INFO] Documented supersession: the layout route and its entry points
  Found: docs/superpowers/specs/2026-10-15-ihome-layout-editor-design.md A16 (SPEC) makes editing
  reachable as Ctrl/Cmd+click → the placement in `#/layout`, "plus an explicit edit mode for touch";
  the tile-editor spec A24 extends the same handoff to page/section targets; the display spec §7 sends
  the same Ctrl/Cmd+click to the device form in `#/devices`.
  Note: docs/superpowers/specs/2026-10-18-ihome-layout-sheet-design.md A43–A50 (SPEC) retire all of
  it: the editor is a mode of the display (`#/` stays the URL), the layout route, its app bar tab and
  the two handoff navigations are gone, A29/A33/A34/A40/A42 retire with the tree, and the AppBar
  pencil/eye replaces the edit-mode toggle. The sheet's cursor (A45) and the click-to-select layer
  (A48) are the current entry points. Synthesis treats the sheet as authoritative.

[INFO] Additive extension (no supersession stated): `DeviceType` grew from 9 to 11
  Found: docs/superpowers/specs/2026-10-09-device-config-ui-design.md §2 (SPEC, Status "Draft")
  declares `DeviceType = Switch | Light | Thermostat | Blind | Window | AC | Thermometer | Value |
  Custom`.
  Note: docs/superpowers/specs/2026-10-14-ihome-display-design.md §4.2 (SPEC) ships presets for
  **Button** and **Motion** as well, which the earlier union does not contain. The earlier doc is a
  then-current inventory, not a prohibition, and nothing in it is invalidated (all nine members
  survive), so this is an extension rather than a competing variant — but the union has two definitions
  in this set. Current set (and what the code carries): the nine plus `Button` and `Motion`.

[INFO] Additive extension (no supersession stated): the config shell's route
  Found: docs/superpowers/specs/2026-10-09-device-config-ui-design.md §4 and its plan put device CRUD
  at `/config/devices` with a new "Config" header tab.
  Note: docs/superpowers/specs/2026-10-14-ihome-display-design.md §3 (SPEC) describes the config shell
  as `/devices`, `/pages`, `/templates`, `/settings`, "keeping today's shell", with the Home tab
  dropped. The later SPEC's route list is the current one; `/config/devices` is history.

[INFO] Cross-reference cycle: slot-icons ↔ slot-sparklines (inspected; resolved by chronology)
  Found: cycle detection over the classification `cross_refs` found one cycle —
  `2026-10-19-ihome-slot-icons-design.md` → `2026-10-20-ihome-slot-sparklines-design.md` →
  `2026-10-19-ihome-slot-icons-design.md`. The rest of the ref graph is acyclic (longest chain 5:
  device-icons → slot-icons → tile-editor → layout-editor → display), well inside the depth cap of 50.
  Note: the cycle is a forward citation, not a synthesis dependency. The sparklines spec (10-20) names
  the icons spec as "the descriptor pattern this copies" (its own "Depends on:" line), while the icons
  spec's mention of the chart slot is an after-the-fact note dated 2026-10-20/21 ("the chart slot
  followed the same per-slot-descriptor pattern … A59–A64"; A56 "retired on 2026-10-20"; A70
  "(2026-10-21)"). Each document is complete without the other and neither overrides the other's
  content (A51–A58 own the icon, A59–A64 own the chart, and A59 copies A51), so **both were
  synthesized** rather than excluded as a cyclic set. No user action required; recorded so the check is
  not mistaken for skipped.

[INFO] Documented supersession: the history slice's "no charting" non-goal
  Found: docs/superpowers/specs/2026-10-13-history-controls-design.md §1 (SPEC) lists "No charting in
  this iteration. The sparkline is a compact inline SVG, not a chart" as a non-goal.
  Note: the display spec then added `sparkline`/`history-list` slot kinds and the tile chart layer
  (A22/A32), and the sparklines spec A61 draws every enabled series in one chart area. The non-goal
  scoped that one iteration; the charting work is owned by the later specs. `history-list` is untouched
  throughout.
