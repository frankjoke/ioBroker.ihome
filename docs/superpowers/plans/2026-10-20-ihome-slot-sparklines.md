# Slot Sparklines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chart becomes a property of the value slot it describes — one chart area on the tile with all
its series, and a chart inside each value's detail row — retiring `kind: "sparkline"`.

**Architecture:** A per-slot `Slot.spark` descriptor (the A51 icon pattern), resolved by pure functions in
`tile-parts` (`tileSeries`, `rowSpark`, `hasHistory`, colours from a theme palette), drawn by one new
`TileChart` component in two places (the tile's background layer, the modal row's middle cell). The history
store keeps fetching per control; nothing moves there.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, Vite/SvelteKit.

**Spec:** `docs/superpowers/specs/2026-10-20-ihome-slot-sparklines-design.md` (A59–A64).

## Global Constraints

- TypeScript strict; Svelte 5 runes (`$state`, `$derived`, `$props`); no new dependencies.
- Pure, testable logic lives in `src/lib/config/*` (`tile-parts.ts`, `tile-ops.ts`, `history-ops.ts`).
- Vitest with `expect.requireAssertions` — every test asserts.
- One commit per task; the fix is complete only when `npm test`, `npm run check`, `npm run lint` and
  `npm run build` are green.
- Live documents are written only through the app's store (`commitLayout`, `updatedAt` bumped); no direct
  `set_state` outside that one approved migration.
- Neither the page/tile group ids nor the device ids in the document change.
- Palette order is fixed: `--primary-color`, `--success-color`, `--warning-color`, `--danger-color`,
  `--secondary-color`.

## Review Focus

1. A `spark` whose control resolves to nothing (typo'd `source`) — draws nothing, throws nothing; the
   editor says so.
2. A constant or single-sample series — the flat centre line, never an empty `<svg>` or a division by zero.
3. Two series in different units (9 °C temperature, 44 % humidity) — each spans the full height, x is
   shared, no NaNs.
4. A tile whose only charted value is modal-only — the **tile** still charts (A60), the row chart shows
   only in the modal.
5. A narrow row with a chart, a long label and a long value — the value must not be pushed out of the row.

---

### Task 1: The descriptor and the resolution

**Files:**
- Modify: `src/lib/types/display.ts` (add `SlotSpark`, `Slot.spark`)
- Modify: `src/lib/config/history-ops.ts` + `history-ops.test.ts` (`seriesPoints`)
- Modify: `src/lib/config/tile-parts.ts` + `tile-parts.test.ts` (`hasHistory`, `CHART_PALETTE`,
  `tileSeries`, `rowSpark`, `parts.rows`)
- Modify: `src/lib/config/tile-ops.ts` + `tile-ops.test.ts` (`patchSpark`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface SlotSpark { enabled?: boolean; where?: "tile" | "both" | "modal"; color?: string }`;
    `Slot.spark?: SlotSpark`.
  - `interface ChartSeries { slot: Slot; control: SlotControl; color: string }`.
  - `seriesPoints(series: HistoryPoint[], opts: { from: number; to: number; width: number; height: number; pad?: number }): string`.
  - `hasHistory(control?: SlotControl): boolean`.
  - `const CHART_PALETTE: string[]`.
  - `tileSeries(rows: SlotRow[]): ChartSeries[]`.
  - `rowSpark(rows: SlotRow[], row: SlotRow, home: "tile" | "modal"): ChartSeries | undefined`.
  - `tileParts(...).rows: SlotRow[]` (every resolved, visible row exactly once; `body`/`modal` derived
    from it).
  - `patchSpark(tile: TileConfig, index: number, patch: Partial<SlotSpark>): TileConfig`.

- [ ] **Step 1: Write the failing tests**

`history-ops.test.ts`:
```ts
describe("seriesPoints (A61)", () => {
  it("places points by timestamp across a shared window", () => {
    expect(seriesPoints([{ ts: 0, val: 0 }, { ts: 1000, val: 10 }],
      { from: 0, to: 1000, width: 100, height: 20 })).toBe("0,20 100,0");
  });
  it("keeps a shorter series in the right-hand part of the window", () => {
    const pts = seriesPoints([{ ts: 500, val: 0 }, { ts: 1000, val: 0 }],
      { from: 0, to: 1000, width: 100, height: 20 });
    expect(pts.startsWith("50,")).toBe(true);
  });
  it("draws the centre line for a constant or one-point series", () => {
    const one = seriesPoints([{ ts: 1, val: 5 }], { from: 0, to: 10, width: 100, height: 20 });
    const flat = seriesPoints([{ ts: 0, val: 5 }, { ts: 10, val: 5 }],
      { from: 0, to: 10, width: 100, height: 20 });
    expect(one).toBe(flat);
    expect(flat).toContain(",10"); // the vertical centre
  });
  it("returns '' for no points and falls back to index spacing on a degenerate window", () => {
    expect(seriesPoints([], { from: 0, to: 1, width: 10, height: 10 })).toBe("");
    expect(seriesPoints([{ ts: 5, val: 0 }, { ts: 5, val: 10 }],
      { from: 5, to: 5, width: 100, height: 20 })).toBe("0,20 100,0");
  });
});
```

`tile-parts.test.ts` (a history-carrying control helper added near the top, plus these):
```ts
const withHistory = (id: string, feature: string) =>
  ({ ...control(id, feature), history: { duration: 24, durationUnit: "hours" } }) as EnrichedControl;

it("charts a value whose control has history, in slot order (A61)", () => {
  const dev = device({ controls: [withHistory("c1", "temperature"), control("c2", "humidity")] });
  const parts = tileParts(dev, tile([
    { kind: "value", source: "temperature", spark: {} },
    { kind: "value", source: "humidity", spark: {} },
  ]), none);
  expect(parts.rows.length).toBe(2);
  const series = tileSeries(parts.rows);
  expect(series.map((s) => s.control.id)).toEqual(["c1"]); // humidity has no history
  expect(series[0].color).toBe(CHART_PALETTE[0]);
});

it("honours home, the soft off and an explicit colour (A59/A61)", () => {
  const dev = device({ controls: [withHistory("c1", "temperature")] });
  const modalOnly = tileParts(dev, tile([
    { kind: "value", source: "temperature", where: "modal", spark: {} },
  ]), none);
  expect(tileSeries(modalOnly.rows).map((s) => s.control.id)).toEqual(["c1"]); // A60
  const off = tileParts(dev, tile([
    { kind: "value", source: "temperature", spark: { enabled: false } },
  ]), none);
  expect(tileSeries(off.rows)).toEqual([]);
  const own = tileParts(dev, tile([
    { kind: "value", source: "temperature", spark: { color: "#123456" } },
  ]), none);
  expect(tileSeries(own.rows)[0].color).toBe("#123456");
  const modalHome = tileParts(dev, tile([
    { kind: "value", source: "temperature", spark: { where: "modal" } },
  ]), none);
  expect(rowSpark(modalHome.rows, modalHome.rows[0], "modal")?.control.id).toBe("c1");
});

it("keeps the palette index stable across homes (A61)", () => {
  const dev = device({ controls: [withHistory("c1", "temperature"), withHistory("c2", "humidity")] });
  const parts = tileParts(dev, tile([
    { kind: "value", source: "temperature", spark: {} },
    { kind: "value", source: "humidity", spark: { where: "modal" } },
  ]), none);
  expect(tileSeries(parts.rows).map((s) => s.color)).toEqual([CHART_PALETTE[0]]);
  expect(rowSpark(parts.rows, parts.rows[1], "modal")?.color).toBe(CHART_PALETTE[1]);
});
```

`tile-ops.test.ts` (mirrors the `patchIcon` tests):
```ts
it("patches one spark field and never leaves {} behind", () => {
  const t: TileConfig = { slots: [{ kind: "value", source: "power" }] };
  expect(patchSpark(t, 0, { enabled: true }).slots?.[0].spark).toEqual({ enabled: true });
  expect(patchSpark(patchSpark(t, 0, { enabled: true }), 0, { color: "#f00" }).slots?.[0].spark)
    .toEqual({ enabled: true, color: "#f00" });
  expect(patchSpark(patchSpark(t, 0, { enabled: true }), 0, { enabled: undefined }).slots?.[0].spark)
    .toBeUndefined();
  expect(patchSpark(t, 9, { color: "#f00" }).slots).toEqual(t.slots);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/config/history-ops.test.ts src/lib/config/tile-parts.test.ts src/lib/config/tile-ops.test.ts`
Expected: FAIL — `seriesPoints`/`tileSeries`/`rowSpark`/`patchSpark`/`CHART_PALETTE` are not exported.

- [ ] **Step 3: Implement**

- `types/display.ts`: add `SlotSpark` (doc comment: A59, `enabled` absent = on, `where` absent = both) and
  `Slot.spark?: SlotSpark`.
- `history-ops.ts`: `seriesPoints(series, { from, to, width, height, pad = 0 })` — empty series → `""`; a
  one-point or constant series → the flat centre line; otherwise `x = pad + ((ts - from) / (to - from)) * (width - 2 * pad)`,
  `y = height - pad - ((val - min) / (max - min)) * (height - 2 * pad)`; when `to <= from`, fall back to the
  index spacing `sparklinePoints` uses. Clamp x to `[pad, width - pad]` so an out-of-window sample does not
  fly off. Keep `sparklinePoints` untouched (the device editor's previews use it).
- `tile-parts.ts`:
  - `CHART_PALETTE = ["var(--primary-color)", "var(--success-color)", "var(--warning-color)", "var(--danger-color)", "var(--secondary-color)"]`.
  - `hasHistory(control)` → `!!control?.stateId && !!control.history`.
  - `chartEnabled(slot, home)` → `slot.spark` present, `enabled !== false`, and `spark.where ?? "both"`
    allows `home`.
  - colour index: position of the slot among `rows` whose slot charts in *any* home and whose control has
    history, in row order; `paletteIndex % CHART_PALETTE.length`.
  - `tileSeries(rows)` → rows with `chartEnabled(slot, "tile")` and `hasHistory(control)`, mapped to
    `ChartSeries`.
  - `rowSpark(rows, row, home)` → the `ChartSeries` when that row charts in `home` and has history.
  - `tileParts` returns `rows` (the resolved, visible rows, built where `body`/`modal` are built today);
    `body`/`modal` derive from `rows` by `slotWhere`. Keep the existing list names and contents (the
    `background` list goes — nothing but sparklines ever set `options.background`).
- `tile-ops.ts`: `patchSpark` = the `patchIcon` body with `SlotSpark`.

- [ ] **Step 4: Run the tests and the gates**

Run: `npm test && npm run check && npm run lint`
Expected: all green (the new tests pass, no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/display.ts src/lib/config/history-ops.ts src/lib/config/history-ops.test.ts \
  src/lib/config/tile-parts.ts src/lib/config/tile-parts.test.ts \
  src/lib/config/tile-ops.ts src/lib/config/tile-ops.test.ts
git commit -m "feat(config): the spark descriptor and its resolution (A59-A61)"
```

---

### Task 2: Migrate the live document

**Files:** none (a one-off write through the running app; no commit).

**Interfaces:**
- Consumes: `SlotSpark` (Task 1) is *not* needed for the write — the write only sets `Slot.spark`.
- Produces: a live `0_userdata.0.Test.AiHome.pageList` with no `kind: "sparkline"` slot, five `spark`
  descriptors, and two inserted modal-only watts value rows (A64).

- [ ] **Step 1: Dry-run the migration and read back the report**

In the running app (`localhost:5173`, Host `192.168.178.9:8081`, namespace `0_userdata.0.Test.AiHome`),
clone `getPageRegistry()`, and for each tile: find the `kind: "sparkline"` slot; resolve its `source` with
`resolveControl(device.controls, source)`; find the first `value` row on that tile resolving to the same
control id (`pickSlotControls` semantics); set its `spark = { enabled: true, where: "tile" }`; remove the
sparkline slot. With no such row, append `{ kind: "value", source, where: "modal", spark: { enabled: true, where: "tile" } }`.
Report one line per tile (tile id, chart source, target row or "inserted"). Do **not** write yet.

- [ ] **Step 2: Show the report and get the go-ahead**

Expected: Rooms/Bad and Home/Klima thermometers and Garten-Pool Light fold onto an existing row; the two
Brunnen tiles report "inserted".

- [ ] **Step 3: Write through the store and verify read-only**

`commitLayout(registry)` with `updatedAt: Date.now()`; then read `pageList` back and assert: zero
`"kind":"sparkline"` occurrences, five `"spark"` descriptors, the two inserted rows present with
`where: "modal"`.

- [ ] **Step 4: Verify in the app**

Display: the five tiles still show a background line; the Brunnen detail pages now show a watts row.
Editor: the Brunnen tiles' value rows no longer offer the removed chart dropdown (still present until
Task 3–4) — this step only confirms the document.

---

### Task 3: The renderer

**Files:**
- Create: `src/lib/components/display/TileChart.svelte`
- Modify: `src/lib/components/display/Tile.svelte` (`.tile-bg` → `TileChart`, `modalRows` gain `spark`)
- Modify: `src/lib/components/display/ModalPanel.svelte` (label → chart → value)
- Modify: `src/lib/components/display/SlotRenderer.svelte` (drop the sparkline branch)
- Delete: `src/lib/components/display/slots/SparklineSlot.svelte`

**Interfaces:**
- Consumes: `tileSeries`, `rowSpark`, `ChartSeries`, `parts.rows` (Task 1); `seriesPoints` (Task 1).
- Produces: `TileChart` props `{ series: ChartSeries[]; stretch?: boolean }`.

- [ ] **Step 1: Write `TileChart.svelte`**

`<svg viewBox="0 0 120 28" preserveAspectRatio={stretch ? "none" : "xMidYMid meet"}>` with one `<polyline>`
per series. Per series (`s`): `ensureHistory(ioBroker, s.control.stateId, s.control.history)`, `noteLive` of
the current state when newer, `readHistory`; window `from = now - max(durationMs(spec))` over the series,
`to = now`; `seriesPoints(entry.series, { from, to, width: 120, height: 28 })`; stroke = `s.color`. A series
with no points draws nothing (the others still draw). No `{:else}` placeholder.

- [ ] **Step 2: Wire the tile and the modal row**

- `Tile.svelte`: `.tile-bg` renders `<TileChart series={tileSeries(parts.rows)} stretch />` when that list is
  non-empty; the `:global(.spark)` and placeholder rules go.
- `ModalPanel.svelte`: after `.row-label`, a `.row-chart` cell (`flex: 1; min-width: 0`) with
  `<TileChart series={[r.spark]} stretch />`; `.row-control` stops growing when `r.spark` is present.

- [ ] **Step 3: Delete the old path**

`SparklineSlot.svelte`; `SlotRenderer`'s import and `sparkline` branch; the `sparkline` case in
`Tile.svelte`'s modal-row comment. `SlotKind` still lists `"sparkline"` until Task 4 — nothing renders it.

- [ ] **Step 4: Gates and a live pass**

Run: `npm test && npm run check && npm run lint && npm run build`
Live: the five tiles show their lines in the chart area; a charted row shows label | chart | value.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/components/display
git commit -m "feat(display): the tile chart and the row chart (A61/A62)"
```

---

### Task 4: The editor, and the kind retires

**Files:**
- Modify: `src/lib/components/layout/LayoutDetails.svelte` (Sparkline block; drop the chart dropdown;
  `KIND_GLYPH` loses `sparkline`)
- Modify: `src/lib/components/layout/SlotPicker.svelte` (`DEVICE_KINDS` loses `sparkline`)
- Modify: `src/lib/types/display.ts` (`SlotKind` loses `"sparkline"`)
- Modify: `src/lib/components/display/SlotRenderer.svelte` (`needsControl` loses `sparkline`)
- Modify: `src/lib/config/template-ops.ts` only if a `sparkline` special case remains

**Interfaces:**
- Consumes: `patchSpark` (Task 1), `tileSeries`' colour rule (for the swatch's Auto label).
- Produces: nothing later tasks use.

- [ ] **Step 1: The Sparkline block**

In the expanded pane of a `value` slot, next to the Icon block: a toggle (`patchSpark(t, i, { enabled: true | false })`),
a colour control with an **Auto** state (`{ color: undefined }`) using the existing solid-colour control, and
the same `where` tri-state cycle as the icon. Disabled with the hint *"no history for this control —
configure it in the device editor"* when `hasHistory(controlFor(slot))` is false. The collapsed row shows a
`show_chart` marker when `slot.spark` is enabled.

- [ ] **Step 2: Drop the tile-level chart control and the kind**

Remove `chartSources`, `currentChart`, `setChart` and the Chart dropdown markup; `sparkline` from
`KIND_GLYPH`, `DEVICE_KINDS`, `needsControl` and `SlotKind`.

- [ ] **Step 3: Gates and a live pass**

Run: `npm test && npm run check && npm run lint && npm run build`
Live: the tile pane shows the Sparkline block on a history-carrying value and the hint on one without; the
collapsed row shows the chart marker; no Chart dropdown anywhere; the `+` picker offers no sparkline.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/components src/lib/types/display.ts src/lib/config
git commit -m "feat(editor): the sparkline block, and kind \"sparkline\" retires (A59/A63)"
```

---

### Task 5: Docs and handoff

- [ ] **Step 1:** Note the retirement in the A51–A58 spec's scope line (its legacy-`kind: "icon"`
  retirement sentence is already done; add that `kind: "sparkline"` retired per A59 — one line).
- [ ] **Step 2:** Write `docs/progress/handoff-2026-10-20-b-iobroker-visual-adapter.md` (or the next dated
  handoff): what landed, the migration report, the gates, the live checks, and the open items
  (`history-list` untouched, no legend, the palette inset constant).
- [ ] **Step 3:** Commit.

```bash
git add docs && git commit -m "docs: the sparklines, handed off"
```
