import { it, expect } from "vitest";
import {
  collectStates,
  applyFilters,
  buildStateTree,
  collectVisibleLeaves,
  ancestorObjects,
  parentName,
  nodeKey,
} from "$lib/config/state-tree";

it("gives a state and a folder with the same path distinct keys", () => {
  const objs = new Map<string, any>([
    ["mqtt.0.f", { _id: "mqtt.0.f", type: "state", common: { name: "F" } }],
    ["mqtt.0.f.s", { _id: "mqtt.0.f.s", type: "state", common: { name: "S" } }],
  ]);
  const tree = buildStateTree(collectStates(objs));
  const adapter = tree.find((n) => n.id === "mqtt.0")!;
  const keys = adapter.children!.map(nodeKey);
  expect(new Set(keys).size).toBe(keys.length);
});

it("resolves the parent name from common.name or the id segment", () => {
  expect(parentName(objects, "hue.0.lamp.on")).toBe("Lamp");
  expect(parentName(objects, "a.0.folder.x")).toBe("folder");
});

const objects = new Map<string, any>([
  [
    "hue.0.lamp.on",
    {
      _id: "hue.0.lamp.on",
      type: "state",
      common: { name: "Lamp", type: "boolean", role: "switch" },
    },
  ],
  [
    "hue.0.lamp.bri",
    {
      _id: "hue.0.lamp.bri",
      type: "state",
      common: { name: "Bright", type: "number", role: "level" },
    },
  ],
  [
    "hue.0.lamp",
    { _id: "hue.0.lamp", type: "channel", common: { name: "Lamp" } },
  ],
  [
    "zigbee.0.temp",
    {
      _id: "zigbee.0.temp",
      type: "state",
      common: { name: "Temp", type: "number", role: "value.temperature" },
    },
  ],
]);

it("collects only state objects", () => {
  expect(collectStates(objects).every((s) => s.obj.type === "state")).toBe(
    true,
  );
  expect(collectStates(objects)).toHaveLength(3);
});
it("filters by adapter", () => {
  expect(
    applyFilters(collectStates(objects), { adapter: "hue.0" }),
  ).toHaveLength(2);
});
it("filters by role substring", () => {
  expect(applyFilters(collectStates(objects), { role: "level" })).toHaveLength(
    1,
  );
});
it("filters by type", () => {
  expect(
    applyFilters(collectStates(objects), { type: "boolean" }),
  ).toHaveLength(1);
});
it("filters by text search over id and name", () => {
  expect(
    applyFilters(collectStates(objects), { search: "bright" }),
  ).toHaveLength(1);
});
it("treats empty filter values as no filter", () => {
  expect(
    applyFilters(collectStates(objects), {
      adapter: "",
      room: [],
      type: [],
      role: [],
      search: "",
    }),
  ).toHaveLength(3);
});
it("filters by multiple roles (OR within a field)", () => {
  expect(
    applyFilters(collectStates(objects), { role: ["level", "switch"] }),
  ).toHaveLength(2);
});
it("filters by multiple types", () => {
  expect(
    applyFilters(collectStates(objects), { type: ["boolean", "number"] }),
  ).toHaveLength(3);
});
it("filters by room using the injected resolver", () => {
  const roomsOf = (id: string) =>
    id.startsWith("zigbee") ? ["enum.rooms.living"] : [];
  expect(
    applyFilters(
      collectStates(objects),
      { room: "enum.rooms.living" },
      roomsOf,
    ),
  ).toHaveLength(1);
});
it("collects ancestor objects walking up the id", () => {
  const anc = ancestorObjects(objects, "hue.0.lamp.on");
  expect(anc.map((o: any) => o._id)).toContain("hue.0.lamp");
});
it("collects leaves only under expanded branches, up to the limit", () => {
  const tree = buildStateTree(collectStates(objects));
  const expanded = new Set<string>(["hue.0", "hue.0.lamp"]);
  expect(collectVisibleLeaves(tree, expanded).sort()).toEqual([
    "hue.0.lamp.bri",
    "hue.0.lamp.on",
  ]);
});
it("returns nothing while all branches are collapsed", () => {
  const tree = buildStateTree(collectStates(objects));
  expect(collectVisibleLeaves(tree, new Set())).toEqual([]);
});
it("resolves a localized name for the label", () => {
  const objs = new Map<string, any>([
    [
      "a.0.x",
      {
        _id: "a.0.x",
        type: "state",
        common: { name: { en: "Lamp", de: "Lampe" } },
      },
    ],
  ]);
  const tree = buildStateTree(collectStates(objs));
  expect(tree[0].children![0].label).toBe("Lamp");
});
it("searches a localized name", () => {
  const objs = new Map<string, any>([
    [
      "a.0.x",
      {
        _id: "a.0.x",
        type: "state",
        common: { name: { en: "Lamp", de: "Lampe" } },
      },
    ],
  ]);
  expect(applyFilters(collectStates(objs), { search: "lampe" })).toHaveLength(
    1,
  );
});
it("builds an adapter-rooted tree with state leaves", () => {
  const tree = buildStateTree(collectStates(objects));
  expect(tree.map((n) => n.id).sort()).toEqual(["hue.0", "zigbee.0"]);
  const hue = tree.find((n) => n.id === "hue.0")!;
  const leaves: string[] = [];
  const walk = (n: any) =>
    n.kind === "state" ? leaves.push(n.id) : n.children?.forEach(walk);
  walk(hue);
  expect(leaves.sort()).toEqual(["hue.0.lamp.bri", "hue.0.lamp.on"]);
});
