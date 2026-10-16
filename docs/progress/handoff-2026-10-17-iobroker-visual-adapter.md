# Handoff — 2026-10-17 — iobroker-visual-adapter

Previous handoff: `handoff-2026-10-16-b-iobroker-visual-adapter.md` (P2 tile editor end to end,
tasks 1–18, then the same-day follow-ups T19–T30 — read it for the full P2 detail and the browser
checklist). This session (late 10-16 → 10-17) is the **adoption pass**: the user tested the editor in
the browser and fed one adaptation after another; T31–T36 landed, the last two on the **chart layer**.

---

## 1. Where we are

- Branch `feature/ihome-display` at **`bb0edf1`**, working tree clean (handoff commit follows).
  **No remote, nothing pushed, nothing merged, nothing packaged.**
- **All gates green:** `npm run check` 0/0, `npm test` **318 passed** (27 files), `npm run lint` 0,
  `npm run build` writes `www/`. `graphify update .` refreshed after every change.
- Ledger (session memory, gitignored):
  `.superpowers/sdd/2026-10-16-ihome-tile-editor/progress.md` — rulings T1–T36 with per-task commits.
- Spec amendments A18–**A32** in `docs/superpowers/specs/2026-10-16-ihome-tile-editor-design.md`
  (A32 = the chart layer; A22's "drawn behind the content" is superseded).
- Live broker `192.168.178.9` (admin 8081, web.0 8082), read-only checks this session. Document:
  **version 1, 3 pages / 34 groups / 18 placements, 5 materialised tiles**, `templateList` still
  absent (the first Save-as-template writes version 1). `updatedAt` moved — the user edits live.
- **The user's live tiles now carry 5 chart slots** — all
  `{kind: "sparkline", source, options: {background: true}}` on 1–2-wide tiles (Bad, Garten-Pool,
  Wohn-Ess-Z, 2× Klima). The chart layer (T35/T36) is what they are watching.

## 2. What landed this session (12 commits, `abba789..bb0edf1`)

| commit | what |
| --- | --- |
| `a5a4a86` | `.app-main` padding 24px → 8px (mobile override, same value, went with it) |
| `fabe19c` | display page wrapper (`PageView` `.page`) 12px → 8px |
| `d4b3b17` | tile pane's "Change device…" / "Edit device…" → icon buttons (`select` + `edit`) |
| `5358175` | tile pane's Device field name bold (`<strong>`); Template source line untouched |
| `d903fef` | **chart layer**: background charts stretch to the tile (`preserveAspectRatio="none"` via the new `stretch` prop; SlotRenderer passes `options.background`) and render **above** the content (`z-index: 1`; badges stay z 2); spec A32 |
| `c3a7dce` | chart centred at **70% of the tile height** so the badge corners and the name keep their space (drawn 55×67 on a 1-wide tile) |

The diagnosis behind T35 (worth knowing): the chart's 120×28 drawing was **letterboxed** into the
tall tile — an ~11px strip in the middle — and rendered behind the icon/values, so it was both tiny
and hidden. Measured in headless Chrome before/after (55×11 → 55×96 → 55×67 at 70%). The user's own
suggestion ("handle it like the badges — a Z above the tile") is what the fix follows.

## 3. The user's adoption pass — status

- The browser checklist is **`handoff-2026-10-16-b` §4, items 1–18** — the user is walking it while
  adopting; every finding so far became a follow-up (T19–T36) rather than a bug report.
- Confirmed live by the user: the chart layer in **Bad** works and "looks better now" at 70%.
- Not yet re-walked after this session's changes: the padding/icon/bold changes are cosmetic; the
  chart change touches every tile with a chart slot (the 5 above) — worth a glance on the wall
  display and on the tablet breakpoint (51px module; the chart keeps its 70% rule).
- Nothing is blocking; the user stops when they stop.

## 4. Parked / deferred (unchanged from 10-16-b §5)

Parked (not P2): Brunnen double-toggle (device-side), `main.js:34-37` literal `${…}` logging,
duplicate tile titles, unused `house-controller.svg`.

Deferred (do not build unasked): P3 modal slots + `Slot.from`; `/templates` page, template
delete/rename, `basedOn` editing, the device-form `template` field; section member/showEmpty/width
hints; icon upload; drag-and-drop (↑↓ stay); packaging/pushing; I11 focus trap + M1 tree keyboard
contract; undo/redo.

## 5. Next move

1. The user resumes browser testing and sends the next finding; keep the established flow —
   short design in chat → "build it?" → implement → focused tests → `npm test` → `npm run check` 0/0
   → `npm run lint` → `npm run build` → one commit + a ledger line (+ spec amendment when a decision
   changes) → handoff note.
2. **Do not push, merge, or package** until the user explicitly says so.
3. If the chart needs tuning again, the numbers are one place each: `.tile-bg :global(.spark)`
   `height: 70%` in `Tile.svelte`; the stretch flag in `SparklineSlot`/`SlotRenderer`.
