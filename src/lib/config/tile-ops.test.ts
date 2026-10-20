import { it, expect } from "vitest";
import type { Device } from "$lib/types/device";
import type {
  ActiveCondition,
  ActiveOp,
  PageRegistry,
  Placement,
  TemplateRegistry,
  TileConfig,
  Template,
} from "$lib/types/display";
import {
  addRule,
  addSlot,
  applyTemplate,
  editTile,
  ensureTile,
  evalActive,
  materialiseTile,
  moveRule,
  moveSlot,
  nextSlotWhere,
  patchIcon,
  patchSpark,
  patchRule,
  patchSlot,
  removeRule,
  removeSlot,
  resetTile,
  setSlotSource,
  setSlotWhere,
  slotWhere,
  templateFromTile,
  upsertTemplate,
} from "./tile-ops";

const device = (over: Partial<Device> = {}): Device =>
  ({
    id: "d1",
    type: "Switch",
    name: "Pumpe",
    controls: [],
    ...over,
  }) as Device;

const userTemplate = (over: Partial<Template> = {}): Template =>
  ({
    id: "t1",
    name: "Pump",
    type: "Switch",
    slots: [
      {
        kind: "value",
        source: "power",
        rules: [{ when: "power > 0", glow: true }],
      },
    ],
    ...over,
  }) as Template;

it("materialises a tile from the chain: template id, size and a deep-copied slot list", () => {
  const t = userTemplate();
  const tile = materialiseTile(device({ template: "t1" }), [t]);
  expect(tile.template).toBe("t1");
  // The chain is preset base + user template + device slots, merged; the user
  // template's own slot must be in there, deep-copied (never shared).
  const power = tile.slots?.find((s) => s.source === "power");
  expect(power).toBeDefined();
  expect(power).not.toBe(t.slots.at(0));
  expect(power?.rules?.at(0)).not.toBe(t.slots.at(0)?.rules?.at(0));
});

it("materialising without a template names the type preset", () => {
  expect(materialiseTile(device(), []).template).toBe("Switch");
});

it("ensureTile leaves a materialised placement alone and keeps a legacy size", () => {
  const materialised = {
    id: "p",
    device: "d1",
    tile: { size: { w: 2 as const, h: 1 as const }, slots: [] },
  };
  expect(ensureTile(materialised, device(), [])).toBe(materialised);

  const legacy = {
    id: "p",
    device: "d1",
    tile: { size: { w: 2 as const, h: 1 as const } },
  };
  const ensured = ensureTile(legacy, device(), []);
  expect(ensured.tile.size).toEqual({ w: 2, h: 1 });
  expect(Array.isArray(ensured.tile.slots)).toBe(true);
});

it("ensureTile materialises from nothing and resetTile drops the whole tile", () => {
  const bare = { id: "p", device: "d1" };
  const ensured = ensureTile(bare, device(), []);
  expect(ensured.tile.slots!.length).toBeGreaterThan(0);
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
});

it("a slot's where picks its home; the last tile slot cannot move to the modal (A34)", () => {
  const tile: TileConfig = {
    slots: [
      { kind: "value", source: "power" },
      { kind: "button", source: "boost" },
    ],
  };
  expect(slotWhere({ kind: "value" })).toBe("tile"); // absent = tile
  const both = setSlotWhere(tile, 0, "both");
  expect(slotWhere(both.slots!.at(0)!)).toBe("both");
  expect(slotWhere(both.slots!.at(1)!)).toBe("tile");
  // The second slot can leave the tile because the first still lives there.
  const modal = setSlotWhere(both, 1, "modal");
  expect(slotWhere(modal.slots!.at(1)!)).toBe("modal");
  // A badge renders on the tile too, so it alone keeps a tile from emptying.
  const badge = setSlotWhere(
    { slots: [{ kind: "value", source: "a" }, { kind: "badge" }] },
    0,
    "modal",
  );
  expect(slotWhere(badge.slots!.at(0)!)).toBe("modal");
  // The only slot cannot move out: refused, the tile comes back untouched.
  const lone = setSlotWhere(
    { slots: [{ kind: "value", source: "power" }] },
    0,
    "modal",
  );
  expect(lone.slots?.at(0)?.where).toBeUndefined();
  // Back to the default drops the field instead of storing "tile".
  const back = setSlotWhere(both, 0, "tile");
  expect(back.slots?.at(0)).toEqual({ kind: "value", source: "power" });
  // A bad index leaves the tile alone.
  expect(setSlotWhere(tile, 9, "modal")).toBe(tile);
  // The row button's cycle: tile → both → modal → tile, but "modal" is skipped
  // while this is the only slot on the tile (2 = it plus one more).
  expect(nextSlotWhere({ kind: "value" }, 2)).toBe("both");
  expect(nextSlotWhere({ kind: "value", where: "both" }, 2)).toBe("modal");
  expect(nextSlotWhere({ kind: "value", where: "both" }, 1)).toBe("tile");
  expect(nextSlotWhere({ kind: "value", where: "modal" }, 1)).toBe("tile");
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
    device(),
    [],
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
      device(),
      [],
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

it("templateFromTile copies, never shares: mutating the tile leaves the template alone", () => {
  const tile: TileConfig = {
    size: { w: 2, h: 2 },
    background: { kind: "solid", value: "#101418" },
    slots: [{ kind: "value", source: "power", rules: [{ when: "power > 0" }] }],
  };
  const t = templateFromTile(tile, device({ type: "Switch" }), [], "  Pumpe  ");
  expect(t.name).toBe("Pumpe");
  expect(t.type).toBe("Switch");
  tile.slots![0].source = "mutated";
  expect(t.slots[0].source).toBe("power");
  expect(t.slots[0]).not.toBe(tile.slots![0]);
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

it("upsertTemplate appends once, then overwrites by name+type keeping the id", () => {
  const empty: TemplateRegistry = { version: 0, updatedAt: 0, templates: [] };
  const one = upsertTemplate(empty, userTemplate({ id: "a", name: "Pump" }));
  expect(one.version).toBe(1);
  const two = upsertTemplate(
    one,
    userTemplate({ id: "b", name: "Pump", slots: [{ kind: "badge" }] }),
  );
  expect(two.templates.length).toBe(1);
  expect(two.templates[0].id).toBe("a");
  expect(two.templates[0].slots).toEqual([{ kind: "badge" }]);
  const otherType = upsertTemplate(
    two,
    userTemplate({ id: "c", name: "Pump", type: "Light" }),
  );
  expect(otherType.templates.length).toBe(2);
});

it("applyTemplate replaces size, slots and background but keeps the active condition", () => {
  const placement: Placement = {
    id: "p",
    device: "d1",
    title: "Garten",
    tile: {
      size: { w: 1, h: 1 },
      background: { kind: "solid", value: "#000" },
      active: { source: "power", op: "truthy" },
      slots: [{ kind: "value", source: "old" }],
    },
  };
  const next = applyTemplate(
    placement,
    userTemplate({
      id: "t9",
      background: { kind: "solid", value: "#111" },
      slots: [{ kind: "value", source: "new" }],
    }),
  );
  expect(next.title).toBe("Garten");
  expect(next.tile?.template).toBe("t9");
  expect(next.tile?.slots).toEqual([{ kind: "value", source: "new" }]);
  expect(next.tile?.background?.value).toBe("#111");
  expect(next.tile?.active?.source).toBe("power");
  const bare = applyTemplate(placement, userTemplate({ id: "t9", slots: [] }));
  expect(bare.tile?.background).toBeUndefined(); // the template has none: the old one drops
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
