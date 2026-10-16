import { it, expect } from "vitest";
import type { Device } from "$lib/types/device";
import type {
  ActiveCondition,
  ActiveOp,
  PageRegistry,
  TileConfig,
  Template,
} from "$lib/types/display";
import {
  addRule,
  addSlot,
  editTile,
  ensureTile,
  evalActive,
  materialiseTile,
  moveRule,
  moveSlot,
  patchRule,
  patchSlot,
  removeRule,
  removeSlot,
  resetTile,
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
