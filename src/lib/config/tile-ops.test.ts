import { it, expect } from "vitest";
import type { Device } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import { ensureTile, materialiseTile, resetTile } from "./tile-ops";

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
