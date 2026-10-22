# Synthesis

Entry point for `gsd-roadmapper`. Everything below is derived from the 22 ingested docs; every claim
traces to a source path in `constraints.md` (SPECs) or `context.md` (plans).

## Doc counts by type

| type | count | paths |
|---|---|---|
| SPEC | 11 | `docs/superpowers/specs/2026-*-design.md` |
| DOC | 11 | `docs/superpowers/plans/2026-*.md` |
| ADR | 0 | — |
| PRD | 0 | — |
| UNKNOWN | 0 | — |

All 22 classifications were high-confidence with `manifest_override: true` (types supplied by the
manifest); none carried a `precedence` override and none was `locked`.

## Decisions locked

**0.** No ADR is in the set and no doc is marked `locked`, so there is nothing the conflict engine must
protect from override. The A-numbered decisions in the SPECs are design decisions with no Accepted
status: `A1`–`A7` (display), `A8`–`A17` (layout editor), `A18`–`A42` + `A71` (tile editor), `A43`–`A50`
(layout sheet), `A51`–`A58` + `A70` (slot icons), `A59`–`A64` (slot sparklines), `A65`–`A69` (device
icons), plus the plain "Decisions" lists in the 2026-10-09, 2026-10-10 (×2) and 2026-10-13 specs. All
are transcribed in `constraints.md`.

## Requirements extracted

**0** (`REQ-*`): no PRD was ingested, so no requirement IDs were derived and no acceptance criteria
exist. The specs' own "Intent" / "Success criteria" sections are the nearest equivalent and are carried
per spec in `constraints.md`.

## Constraints

**30 entries** — 15 `api-contract`, 8 `schema`, 5 `nfr`, 2 `protocol` — in `constraints.md`, one
source path each. Coverage per spec:

- 2026-10-09 device config UI — 3 (transform contract, device/control schema + feature table, picker
  value policy)
- 2026-10-10 virtual states — 2 (model + engine/helper API, v1 limits)
- 2026-10-10 formula templates — 2 (storage/shape/seed, copy-on-select reuse semantics)
- 2026-10-13 history controls — 4 (model + getHistory options, read contract, store/loading policy,
  availability + UI)
- 2026-10-14 iHome display — 5 (documents/registries, data model + model rules, slot vocabulary +
  renderer contract, module grid + breakpoint clamp, write discipline/HMR/error handling)
- 2026-10-15 layout editor — 3 (placement model A8–A17, migration contract, interaction/reachability)
- 2026-10-16 tile editor — 4 (materialisation A18, model additions, slot resolution semantics, error
  handling)
- 2026-10-18 layout sheet — 1 (A43–A50, the editor as a mode of the display)
- 2026-10-19 slot icons — 2 (SlotIcon descriptor, legacy icon-slot retirement)
- 2026-10-20 slot sparklines — 2 (SlotSpark descriptor A59–A63, kind retirement + the one-off
  migration A64)
- 2026-10-21 device icons — 2 (resolution from the broker hierarchy, the `iconSrc` URL contract)

## Context topics

**11** — one per plan, in `context.md`, each with its source path: goal, architecture, global
constraints, review focus, task list, and the gates the plan sets for itself.

## Conflicts

**0 blockers, 0 competing variants, 11 auto-resolved / documented** — see
`../INGEST-CONFLICTS.md` for the detail and the evidence.

- 2 are real SPEC-over-DOC resolutions where a plan contradicts its own spec: the display plan's
  breakpoint numbers (150/170/190 vs the spec's 45/90, 51/102, 57/114) and the device-icons plan's
  icon on the tile name line (spec A67: the name line carries none).
- 8 are self-declared or evidenced supersessions inside the SPEC set (slot vocabulary, `TileConfig.
  modal`, the chart layer's z-order wording, the layout route/entry points, the history "no charting"
  non-goal, the formula-templates plan's declared deviation) plus two additive extensions with no
  supersession statement (`DeviceType` 9 → 11, the config shell's route).
- 1 is the only cycle in the cross-ref graph (slot-icons ↔ slot-sparklines): inspected, resolved by
  chronology, both docs synthesized.

Nothing in this set requires a user decision before routing.

## Supersession chain (read this before planning any UI slice)

The 11 specs are one chronological series, and the later ones retire parts of the earlier ones by
A-number. The load-bearing retirements:

- The **editor is a mode of the display, not a route** (A43). There is no `#/layout` route, no layout
  tab, no tree (`LayoutTree.svelte` deleted), no edit-mode toggle, and no docked/modal preview
  (A33/A34 retired by A46). Entry points: the AppBar pencil and a click on a tile in the display (A48).
- **`SlotKind`** is `value | level | color | enum | button | badge | history-list | frame` — `icon` and
  `sparkline` are retired kinds (A56, A59), `frame` was added (A38). A tile's **modal** is expressed by
  `Slot.where` (A34), not by `TileConfig.modal`.
- **Materialisation** is the tile contract: a tile is materialised iff it has `slots`; the first tile
  edit writes a complete `{template, size, slots}`; Reset drops `tile` (A18). Templates are per type
  and applied from the tile pane (A19).
- **Per-slot descriptors are the pattern**: `Slot.icon` (A51) and `Slot.spark` (A59), each with its own
  `where`, each with a soft `enabled: false`, each patched through `patchIcon` / `patchSpark` that never
  leave an empty `{}`.
- **The chart is per value slot** (A59/A61): one chart area on the tile drawing every enabled series in
  slot order, a chart between label and value in the detail row (A62); a control can chart only with
  both a `history` spec and a `stateId` (A63).
- **History is configured per control in the device editor** (`Control.history`, the 2026-10-13 spec) —
  the sparkline work deliberately does not move that configuration.

## Open items carried from the sources

These are stated in the docs themselves and are not conflicts — they are the parts a roadmap may want
to pick up or explicitly drop:

- `Slot.from` (cross-device slots, A11) is in the model but was deferred to a later slice in both the
  layout-editor and tile-editor specs; nothing was built against it.
- The layout-sheet design's own open question: with no list, a tile's position is invisible — keep
  ↑/↓ alone, or show `3 / 7` on the tile line?
- A49: the tile editor's own field groups are still expanded (no one-line fold-outs) — its own design
  is deferred.
- The `/templates` library page, template delete/rename, template inheritance editing and the
  device-form `template` field are non-goals of the tile-editor slice.
- History: the `history-list` kind is untouched by the sparkline change; "should a history line be
  collapsible once there are many" is left open; a clickable sparkline opening a full chart is out of
  scope.
- Two Brunnen charts (A64 amendment) were left un-charted on purpose: their sources carry no history, so
  the user re-adds a chart by configuring history and enabling the toggle on a value row.
- Virtual states: whether a virtual control may reference another virtual control on the same device is
  left open for v1 (no dependency resolution; revisit with ordered evaluation + cycle detection).
- The specs' explicit non-goals stand: no absolute placement, no drag-and-drop canvas, no per-group
  backgrounds, no icon upload/data-URLs in the document, no vis-2 export, no adapter rename/publish
  beyond what later work did.

## Status note (from the codebase map, not from the docs)

`.planning/codebase/` and the repo show the artefacts these docs name already exist: `size-ops.ts`,
`tile-parts.ts`, `tile-ops.ts`, `sheet-cursor.ts`, `tile-hit.ts`, `icon-ops.ts`, `TileChart.svelte`,
`LayoutSheet.svelte`, `Icon.svelte`; `LayoutTree.svelte` and `slots/SparklineSlot.svelte` are gone; the
repo is on `main` with handoffs through 2026-10-22 (adapter packaging, 0.0.1 → 0.0.10). Two designs
still carry "Status: proposed — awaiting review before the plan" (slot sparklines, device icons) and
several plans keep unchecked task boxes (`layout-sheet`, `slot-sparklines`, `device-icons`) even where
the code they describe has landed. Treat the doc status lines as historical; use this file and
`constraints.md` for what the design says, and `.planning/codebase/` for what exists.

## Pointers

- Conflict report: `.planning/INGEST-CONFLICTS.md`
- SPEC constraints: `.planning/intel/constraints.md`
- Plan context: `.planning/intel/context.md`
- Decisions: `.planning/intel/decisions.md` (none — no ADR ingested)
- Requirements: `.planning/intel/requirements.md` (none — no PRD ingested)
- Codebase grounding: `.planning/codebase/{STACK,ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,INTEGRATIONS,CONCERNS}.md`
