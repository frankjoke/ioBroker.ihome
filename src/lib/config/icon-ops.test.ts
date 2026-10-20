import { it, expect } from "vitest";
import {
  deviceObjectIcon,
  objectIconValue,
  ownerOf,
  resolveIcon,
} from "$lib/config/icon-ops";

it("names the adapter and instance an id belongs to", () => {
  expect(ownerOf("alias.0.1Stock.TemperaturBad")).toEqual({
    adapter: "alias",
    instance: "0",
  });
  expect(ownerOf("system.adapter.bambulab.0")).toEqual({
    adapter: "bambulab",
    instance: "0",
  });
  expect(ownerOf("system.adapter.bambulab")).toEqual({
    adapter: "bambulab",
    instance: undefined,
  });
  expect(ownerOf("enum.rooms.Bad")).toEqual({
    adapter: "enum",
    instance: "rooms",
  });
});

it("reads the first icon field an object carries (A65)", () => {
  expect(
    objectIconValue({
      common: { modelIcon: "m.png", extIcon: "e.png", icon: "i.png" },
    }),
  ).toEqual({ field: "modelIcon", value: "m.png" });
  expect(
    objectIconValue({ common: { extIcon: "e.png", icon: "i.png" } }),
  ).toEqual({ field: "extIcon", value: "e.png" });
  expect(objectIconValue({ common: { icon: "i.png" } })).toEqual({
    field: "icon",
    value: "i.png",
  });
  expect(objectIconValue({ common: { icon: "  " } })).toBeUndefined();
  expect(objectIconValue({ common: {} })).toBeUndefined();
  expect(objectIconValue(undefined)).toBeUndefined();
  expect(objectIconValue({ common: { icon: 42 } })).toBeUndefined();
});

const objects = (entries: [string, unknown][]) => new Map(entries);

it("walks up: the nearest object that carries an icon wins (A65)", () => {
  const channel = objects([
    ["alias.0.Ch.X", {}],
    ["alias.0.Ch", { common: { icon: "data:image/svg+xml;base64,AA" } }],
    ["alias.0", { common: { icon: "/icons/a.png" } }],
    ["system.adapter.alias.0", { common: { extIcon: "https://x/a.png" } }],
  ]);
  expect(resolveIcon(channel, "alias.0.Ch.X")).toEqual({
    from: "alias.0.Ch",
    value: "data:image/svg+xml;base64,AA",
  });

  // A field on the child beats whatever its parent carries.
  const deeper = objects([
    ["a.0.C.X", { common: { extIcon: "https://x/e.png" } }],
    ["a.0.C", { common: { modelIcon: "m.png" } }],
  ]);
  expect(resolveIcon(deeper, "a.0.C.X")).toEqual({
    from: "a.0.C.X",
    value: "https://x/e.png",
  });

  // A parent's icon beats the adapter's.
  const parent = objects([
    ["a.0.C", { common: { icon: "p.png" } }],
    ["system.adapter.a.0", { common: { extIcon: "https://x/a.png" } }],
  ]);
  expect(resolveIcon(parent, "a.0.C.X")).toEqual({
    from: "a.0.C",
    value: "p.png",
  });
});

it("falls back to the adapter, the instance first (A65)", () => {
  const instance = objects([
    ["a.0.C", {}],
    ["system.adapter.a.0", { common: { icon: "a.png" } }],
    ["system.adapter.a", { common: { icon: "package.png" } }],
  ]);
  expect(resolveIcon(instance, "a.0.C.X")).toEqual({
    from: "system.adapter.a.0",
    value: "a.png",
  });

  const pkg = objects([
    ["a.0.C", {}],
    ["system.adapter.a", { common: { icon: "package.png" } }],
  ]);
  expect(resolveIcon(pkg, "a.0.C.X")).toEqual({
    from: "system.adapter.a",
    value: "package.png",
  });

  expect(resolveIcon(objects([]), "a.0.C.X")).toBeUndefined();
  // An id with nothing to walk to terminates instead of looping.
  expect(resolveIcon(objects([]), "single")).toBeUndefined();
});

it("takes the device's first control that resolves (A65)", () => {
  const o = objects([["b.0.Ch", { common: { icon: "b.svg" } }]]);
  expect(deviceObjectIcon(o, ["a.0.none", "b.0.Ch.X", "c.0.Ch.Y"])).toEqual({
    from: "b.0.Ch",
    value: "b.svg",
  });
  expect(deviceObjectIcon(o, [undefined, "a.0.none"])).toBeUndefined();
  expect(deviceObjectIcon(o, [])).toBeUndefined();
});
