# Decisions (ADR)

**No ADRs were ingested.** The manifest for this run contains 11 SPEC and 11 DOC entries and no ADR
(`docs/superpowers/specs/2026-*-design.md`, `docs/superpowers/plans/2026-*.md`).

- source: absent — no ADR document in CLASSIFICATIONS_DIR
- status: absent
- decision: absent
- scope: absent

The SPECs do carry decision tables (`A1`–`A71`, with `A8`–`A17` in the layout-editor spec, `A18`–`A42`
plus `A71` in the tile-editor spec, `A43`–`A50` in the layout-sheet spec, `A51`–`A58`/`A70` in the
slot-icons spec, `A59`–`A64` in the slot-sparklines spec, `A65`–`A69` in the device-icons spec, and
plain "Decisions" lists in the 2026-10-09/10-10/10-13 specs). Every classification has
`"locked": false`, and none of these records carries an Accepted-status per decision, so per the
taxonomy they are SPEC constraints, not ADR decisions. They are transcribed in
`INTEL_DIR/constraints.md` and summarised in `INTEL_DIR/SYNTHESIS.md`.

Because nothing in this ingest is `locked`, none of the LOCKED checks in the conflict engine could
trigger (see `CONFLICTS_PATH`).
