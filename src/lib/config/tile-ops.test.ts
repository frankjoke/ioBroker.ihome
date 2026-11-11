import { it, expect } from "vitest";
import type {
  ActiveCondition,
  ActiveOp,
  PageRegistry,
  TileConfig,
} from "$lib/types/display";
import {
  addRule,
  addSlot,
  clearRuleIcons,
  detailSpan,
  editTile,
  ensureTile,
  evalActive,
  moveRule,
  moveSlot,
  onTile,
  patchIcon,
  patchSpark,
  patchRule,
  patchSlot,
  removeRule,
  removeSlot,
  resetTile,
  setLook,
  setSlotDetail,
  setSlotSource,
  setSlotTile,
  withPlacementDefaults,
} from "./tile-ops";

it("ensureTile leaves a materialised placement alone and keeps a legacy size", () => {
  const materialised = {
    id: "p",
    device: "d1",
    tile: { size: { w: 2 as const, h: 1 as const }, slots: [] },
  };
  expect(ensureTile(materialised)).toBe(materialised);

  const legacy = {
    id: "p",
    device: "d1",
    tile: { size: { w: 2 as const, h: 1 as const } },
  };
  const ensured = ensureTile(legacy);
  expect(ensured.tile.size).toEqual({ w: 2, h: 1 });
  expect(ensured.tile.slots).toEqual([]);
});

it("ensureTile fills an empty slot list and resetTile drops the whole tile", () => {
  const bare = { id: "p", device: "d1" };
  const ensured = ensureTile(bare);
  expect(ensured.tile.slots).toEqual([]);
  expect(resetTile(ensured)).toEqual(bare);
});

it("slot ops keep order, copy the tile and bail out on bad indexes", () => {
  const tile: TileConfig = { slots: [{ kind: "value", source: "a" }] };
  const two = addSlot(tile, { kind: "badge", options: { badge: "battery" } });
  expect(two.slots?.length).toBe(2);
  expect(tile.slots?.length).toBe(1); // input untouched
  const reordered = moveSlot(two, 0, 1);
  expect(reordered.slots?.map((s) => s.source ?? "badge")).toEqual([
    "badge",
    "a",
  ]);
  expect(moveSlot(two, 0, 9).slots).toEqual(two.slots); // out-of-range: a copy, no throw
  expect(patchSlot(two, 0, { label: "Leistung" }).slots?.at(0)?.label).toBe(
    "Leistung",
  );
  expect(removeSlot(two, 0).slots?.length).toBe(1);
  // S8: the last slot stays — the tile never becomes empty.
  expect(removeSlot(tile, 0)).toBe(tile);
});

it("a slot's tile presence and detail width are independent (A34)", () => {
  expect(onTile({ kind: "value" })).toBe(true);
  expect(detailSpan({ kind: "value" })).toBe("hidden");
  // The legacy `where` still reads: modal-only, or a full detail row.
  expect(onTile({ kind: "value", where: "modal" })).toBe(false);
  expect(detailSpan({ kind: "value", where: "both" })).toBe("full");
  expect(detailSpan({ kind: "value", where: "modal" })).toBe("full");

  const tile: TileConfig = {
    slots: [
      { kind: "value", source: "power" },
      { kind: "button", source: "boost" },
    ],
  };
  const off = setSlotTile(tile, 0, false);
  expect(onTile(off.slots![0])).toBe(false);
  expect(onTile(off.slots![1])).toBe(true);
  // The last slot on the tile cannot leave it: refused, the tile untouched.
  const lone = setSlotTile(
    { slots: [{ kind: "value", source: "power" }] },
    0,
    false,
  );
  expect(lone.slots?.[0]?.tile).toBeUndefined();
  // Back on drops the field instead of storing `true`.
  const back = setSlotTile(off, 0, true);
  expect(back.slots?.[0]).toEqual({ kind: "value", source: "power" });
  // A badge keeps a tile from emptying, as it renders on the tile.
  const badge = setSlotTile(
    { slots: [{ kind: "value", source: "a" }, { kind: "badge" }] },
    0,
    false,
  );
  expect(onTile(badge.slots![0])).toBe(false);
  // Detail spans: only the non-default is stored.
  expect(detailSpan(setSlotDetail(tile, 0, "half").slots![0])).toBe("half");
  expect(setSlotDetail(tile, 0, "hidden").slots?.[0]?.detail).toBeUndefined();
  // A legacy `where` is dropped on the first new write.
  const legacy = setSlotDetail(
    { slots: [{ kind: "value", where: "both" }] },
    0,
    "half",
  );
  expect(legacy.slots?.[0]).toEqual({ kind: "value", detail: "half" });
  expect(setSlotTile(tile, 9, false)).toBe(tile);
});

it("new slots keep the first three on the tile, the rest become small detail rows", () => {
  let tile: TileConfig = { slots: [] };
  for (let i = 0; i < 5; i++) {
    tile = addSlot(
      tile,
      withPlacementDefaults(tile, { kind: "value", source: `v${i}` }),
    );
  }
  expect(tile.slots?.map(onTile)).toEqual([true, true, true, false, false]);
  expect(tile.slots?.map(detailSpan)).toEqual([
    "hidden",
    "hidden",
    "hidden",
    "half",
    "half",
  ]);
  // A badge keeps its corner and never consumes a body line.
  const badge = addSlot(tile, withPlacementDefaults(tile, { kind: "badge" }));
  expect(onTile(badge.slots!.at(-1)!)).toBe(true);
  // An explicit placement wins.
  expect(
    withPlacementDefaults(tile, {
      kind: "value",
      tile: false,
      detail: "full",
    }),
  ).toEqual({ kind: "value", tile: false, detail: "full" });
  // A page that defaults off the tile gets the whole detail line.
  const page = withPlacementDefaults(tile, {
    kind: "frame",
    options: { url: "x" },
  });
  expect(onTile(page)).toBe(false);
  expect(detailSpan(page)).toBe("full");
});

it("setSlotSource pins one source and drops the dead hint beside it (A36)", () => {
  const tile: TileConfig = {
    slots: [
      { kind: "value", options: { pick: "temperature", index: 1 } },
      { kind: "value", source: "a", options: { pick: "humidity" } },
    ],
  };
  const pinned = setSlotSource(tile, 0, "control-1");
  // The hint is gone, the knobs stay, the sibling object is untouched.
  expect(pinned.slots?.at(0)).toEqual({
    kind: "value",
    source: "control-1",
    options: { index: 1 },
  });
  expect(pinned.slots?.at(1)).toBe(tile.slots?.at(1));
  // Empty options are dropped, not left as a husk.
  expect(setSlotSource(tile, 1, "control-2").slots?.at(1)).toEqual({
    kind: "value",
    source: "control-2",
  });
  // A bad index leaves the tile alone.
  expect(setSlotSource(tile, 9, "control-3")).toEqual(tile);
});

it("rule ops address slot and rule indexes", () => {
  const tile: TileConfig = { slots: [{ kind: "value", source: "a" }] };
  const one = addRule(tile, 0, { when: "power > 0", glow: true });
  const two = addRule(one, 0, { when: "power > 100", icon: "bolt" });
  expect(two.slots?.at(0)?.rules?.length).toBe(2);
  expect(
    patchRule(two, 0, 1, { icon: "flash_on" }).slots?.at(0)?.rules?.at(1)?.icon,
  ).toBe("flash_on");
  expect(moveRule(two, 0, 1, 0).slots?.at(0)?.rules?.at(0)?.icon).toBe("bolt");
  expect(removeRule(two, 0, 0).slots?.at(0)?.rules?.length).toBe(1);
  expect(patchRule(two, 3, 0, {}).slots).toEqual(two.slots); // bad slot index: unchanged
});

it("editTile materialises once, applies the op and leaves siblings alone", () => {
  const reg = {
    version: 1,
    updatedAt: 0,
    pages: [
      {
        id: "p",
        title: "P",
        groups: [
          {
            id: "g",
            title: "G",
            tiles: [
              { id: "t1", device: "d1" },
              { id: "t2", device: "d1" },
            ],
          },
        ],
      },
    ],
  } as PageRegistry;
  const next = editTile(
    reg,
    { pageId: "p", sectionId: "g", placementId: "t1" },
    (t) => addSlot(t, { kind: "value", source: "power" }),
  );
  expect(next.updatedAt).toBeGreaterThan(0);
  const tiles = next.pages[0].groups[0].tiles!;
  expect(tiles[0].tile?.slots?.some((s) => s.source === "power")).toBe(true);
  expect(tiles[1].tile).toBeUndefined(); // sibling untouched
  expect(reg.pages[0].groups[0].tiles![0].tile).toBeUndefined(); // input untouched
  // A stale address changes nothing (the registry wrapper is new, the pages equal).
  expect(
    editTile(
      reg,
      { pageId: "nope", sectionId: "g", placementId: "t1" },
      (t) => t,
    ).pages,
  ).toEqual(reg.pages);
});

it("evalActive — truthy is the on/off reading", () => {
  const c = (op: ActiveOp, value?: string): ActiveCondition => ({
    source: "s",
    op,
    value,
  });
  expect(evalActive(c("truthy"), true)).toBe(true);
  expect(evalActive(c("truthy"), "1")).toBe(true);
  expect(evalActive(c("truthy"), 0)).toBe(false);
  expect(evalActive(undefined, true)).toBe(false);
});

it("evalActive — numeric comparisons when both sides are numbers", () => {
  expect(evalActive({ source: "s", op: "gt", value: "20" }, 22.5)).toBe(true);
  expect(evalActive({ source: "s", op: "gt", value: "20" }, "22.5")).toBe(true);
  expect(evalActive({ source: "s", op: "gte", value: "20" }, "20.0")).toBe(
    true,
  );
  expect(evalActive({ source: "s", op: "lt", value: "20" }, 19)).toBe(true);
  expect(evalActive({ source: "s", op: "eq", value: "20" }, "20.0")).toBe(true);
  expect(evalActive({ source: "s", op: "ne", value: "20" }, "20")).toBe(false);
});

it("evalActive — text fallback is case-insensitive; junk degrades", () => {
  expect(evalActive({ source: "s", op: "eq", value: "Auto" }, "auto")).toBe(
    true,
  );
  expect(evalActive({ source: "s", op: "eq", value: "auto" }, "manual")).toBe(
    false,
  );
  expect(evalActive({ source: "s", op: "gt", value: "b" }, "c")).toBe(true);
  expect(evalActive({ source: "s", op: "gt" }, 5)).toBe(false); // no value
  expect(evalActive({ source: "s", op: "wat" as never, value: "1" }, "1")).toBe(
    false,
  ); // unknown op
  expect(evalActive({ source: "s", op: "eq", value: "" }, "")).toBe(true); // empty is text, not a number
  expect(evalActive({ source: "s", op: "eq", value: "0" }, "")).toBe(false); // "" must not parse as 0
});

it("patches one spark field and never leaves {} behind", () => {
  const t: TileConfig = { slots: [{ kind: "value", source: "power" }] };
  expect(patchSpark(t, 0, { enabled: true }).slots?.[0].spark).toEqual({
    enabled: true,
  });
  expect(
    patchSpark(patchSpark(t, 0, { enabled: true }), 0, {
      color: "#f00",
    }).slots?.at(0)?.spark,
  ).toEqual({ enabled: true, color: "#f00" });
  expect(
    patchSpark(patchSpark(t, 0, { enabled: true }), 0, {
      enabled: undefined,
    }).slots?.at(0)?.spark,
  ).toBeUndefined();

  // A bad index leaves the list — copied — untouched.
  expect(patchSpark(t, 9, { color: "#f00" }).slots).toEqual(t.slots);
});

it("drops a slot's rule glyphs when a glyph is chosen (A70)", () => {
  const tile: TileConfig = {
    slots: [
      {
        kind: "value",
        source: "motion",
        icon: { glyph: "sensors" },
        rules: [
          { when: "truthy(motion)", icon: "directions_run", color: "red" },
          { when: "!truthy(motion)", icon: "directions_walk", disabled: true },
        ],
      },
      { kind: "value", source: "humidity" },
    ],
  };
  const cleared = clearRuleIcons(tile, 0);
  // The glyph is gone, the colour and the state stay.
  expect(cleared.slots?.at(0)?.rules).toEqual([
    { when: "truthy(motion)", icon: undefined, color: "red" },
    { when: "!truthy(motion)", icon: undefined, disabled: true },
  ]);
  expect(cleared.slots?.at(0)?.icon).toEqual({ glyph: "sensors" });
  expect(tile.slots?.at(0)?.rules?.[0].icon).toBe("directions_run"); // input untouched
  // Nothing to drop → the very same tile.
  expect(clearRuleIcons(cleared, 0)).toBe(cleared);
  expect(clearRuleIcons(tile, 9)).toBe(tile);
});

it("patches one icon field and never leaves {} behind", () => {
  const tile: TileConfig = {
    slots: [
      { kind: "value", source: "power" },
      { kind: "value", source: "humidity" },
    ],
  };
  const glyphed = patchIcon(tile, 0, { glyph: "x" });
  expect(glyphed.slots?.at(0)?.icon).toEqual({ glyph: "x" });
  expect(tile.slots?.at(0)?.icon).toBeUndefined(); // input untouched
  expect(glyphed.slots?.at(1)).toBe(tile.slots?.at(1)); // other slots untouched

  // Off keeps the glyph; clearing the glyph drops the empty descriptor.
  expect(patchIcon(glyphed, 0, { enabled: false }).slots?.at(0)?.icon).toEqual({
    glyph: "x",
    enabled: false,
  });
  expect(
    patchIcon(glyphed, 0, { glyph: undefined }).slots?.at(0)?.icon,
  ).toBeUndefined();

  // A bad index leaves the list — copied — untouched.
  expect(patchIcon(tile, 9, { glyph: "x" }).slots).toEqual(tile.slots);
});

it("sets and clears one state's look without touching the other (A71)", () => {
  const tile: TileConfig = {
    slots: [],
    active: { source: "power", op: "truthy" },
    look: { inactive: { glow: "var(--text-muted)" } },
  };
  const set = setLook(tile, "active", { glyph: "bolt", color: "#fff" });
  expect(set.look).toEqual({
    active: { glyph: "bolt", color: "#fff" },
    inactive: { glow: "var(--text-muted)" },
  });
  expect(tile.look).toEqual({ inactive: { glow: "var(--text-muted)" } }); // input untouched

  // Clearing one field keeps the state's others.
  expect(setLook(set, "active", { glyph: undefined }).look).toEqual({
    active: { color: "#fff" },
    inactive: { glow: "var(--text-muted)" },
  });

  // Clearing a state's last field drops the state and, with it, the look.
  const bare = setLook(
    setLook(tile, "inactive", { glow: undefined }),
    "inactive",
    {},
  );
  expect(bare).toEqual({ ...tile, look: undefined });
  // A patch that clears nothing makes no empty state.
  expect(setLook(tile, "active", { glyph: undefined }).look).toEqual(tile.look);
});
