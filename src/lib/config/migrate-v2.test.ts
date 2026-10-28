import { it, expect } from "vitest";
import { migratePagesV2 } from "$lib/config/migrate-v2";
import type { Control, Device } from "$lib/types/device";
import type {
  PageRegistry,
  Placement,
  SlotSource,
  TileConfig,
} from "$lib/types/display";

const ctl = (
  id: string,
  feature: string,
  over: Partial<Control> = {},
): Control => ({
  id,
  feature,
  writable: true,
  ...over,
});

const light = (): Device => ({
  id: "light",
  name: "Light",
  type: "Light",
  controls: [
    ctl("p", "power", { common: { type: "boolean" } }),
    ctl("b", "brightness", { common: { min: 0, max: 100 } }),
  ],
});

const reg = (tiles: Placement[]): PageRegistry => ({
  version: 1,
  updatedAt: 1,
  pages: [{ id: "p", title: "P", groups: [{ id: "g", tiles }] }],
});

const source = (s: unknown): SlotSource => s as SlotSource;

it("migrates a chain-only placement to the device's real controls", () => {
  const { registry, report } = migratePagesV2(
    reg([{ id: "t", device: "light" }]),
    [light()],
    [],
  );
  const placement = registry.pages[0].groups[0].tiles[0];
  expect(placement.device).toBeUndefined();
  const slots = placement.tile?.slots ?? [];
  expect(slots.map((s) => s.kind)).toEqual(["switch", "level", "badge"]);
  expect(slots[0].source).toEqual({
    kind: "control",
    device: "light",
    control: "p",
  });
  expect(slots[1].source).toEqual({
    kind: "control",
    device: "light",
    control: "b",
  });
  expect(slots[2].source).toEqual({ kind: "device", device: "light" });
  expect(report.droppedSlots).toBe(1); // the colour slot has no control
});

it("converts raw states, frames, badges and the active condition", () => {
  const tile: TileConfig = {
    size: { w: 2, h: 1 },
    background: { kind: "solid", value: "#000" },
    pin: "1234",
    active: { source: "power", op: "truthy" },
    slots: [
      { kind: "value", source: "0_userdata.0.raw" },
      { kind: "frame", options: { url: "https://example.com" } },
      { kind: "value", source: "power", label: "Mine" },
      { kind: "badge", source: "offline" },
      {
        kind: "badge",
        source: "ago",
        options: { of: "brightness", from: "lc" },
      },
      { kind: "value", source: "missing" },
    ],
  };
  const { registry, report } = migratePagesV2(
    reg([{ id: "t", device: "light", title: "Lamp", tile }]),
    [light()],
    [],
  );
  const placement = registry.pages[0].groups[0].tiles[0];
  const slots = placement.tile?.slots ?? [];
  expect(placement.tile?.size).toEqual({ w: 2, h: 1 });
  expect(placement.tile?.background).toEqual({ kind: "solid", value: "#000" });
  expect(placement.tile?.pin).toBe("1234");
  expect(placement.tile?.active?.source).toEqual({
    kind: "control",
    device: "light",
    control: "p",
  });
  expect(slots.map((s) => s.source && source(s.source).kind)).toEqual([
    "state",
    undefined,
    "control",
    "device",
    "control",
  ]);
  expect(slots[2]).toMatchObject({
    kind: "switch",
    label: "Mine",
    source: { kind: "control", device: "light", control: "p" },
  });
  expect(slots[4]).toMatchObject({
    kind: "badge",
    source: { kind: "control", device: "light", control: "b" },
    options: { derive: "ago", from: "lc" },
  });
  expect(report.droppedSlots).toBe(1); // the missing source
});

it("drops a placement whose device is gone and has no slots", () => {
  const { registry, report } = migratePagesV2(
    reg([{ id: "t", device: "gone" }]),
    [light()],
    [],
  );
  expect(registry.pages[0].groups[0].tiles).toEqual([]);
  expect(report.droppedPlacements).toBe(1);
});

it("resolves a pick-hint slot to a real control", () => {
  const thermo: Device = {
    id: "thermo",
    name: "Thermometer",
    type: "Thermometer",
    controls: [
      ctl("t", "temperature", {
        label: "Temperature",
        common: { role: "value.temperature", unit: "°C" },
      }),
    ],
  };
  const { registry, report } = migratePagesV2(
    reg([{ id: "t", device: "thermo" }]),
    [thermo],
    [],
  );
  const slots = registry.pages[0].groups[0].tiles[0].tile?.slots ?? [];
  expect(slots[0]).toMatchObject({
    kind: "value",
    source: { kind: "control", device: "thermo", control: "t" },
  });
  expect(report.droppedSlots).toBeGreaterThan(0); // humidity pick has no control
});

it("leaves a v2 placement alone", () => {
  const v2: Placement = {
    id: "t",
    tile: {
      slots: [{ kind: "value", source: { kind: "state", stateId: "x.y" } }],
    },
  };
  const { registry, changed } = migratePagesV2(reg([v2]), [], []);
  expect(changed).toBe(false);
  expect(registry.pages[0].groups[0].tiles[0]).toEqual(v2);
});
