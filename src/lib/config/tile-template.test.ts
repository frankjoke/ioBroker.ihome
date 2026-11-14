import { expect, it } from "vitest";
import { collectTileTemplate, inferTemplateType } from "./tile-template";
import { materializeTemplateTileFromState } from "$lib/config/slot-create";
import type { SourceLook } from "$lib/config/slot-source";
import type { TileConfig } from "$lib/types/display";

const object = (common: Record<string, unknown>) => ({ type: "state", common });

const look: SourceLook = {
  devices: [],
  states: new Map(),
  objects: new Map<string, any>([
    [
      "alias.0.Lamp.SET",
      object({ name: "Lamp", role: "switch.light", type: "boolean" }),
    ],
    [
      "alias.0.Lamp.brightness",
      object({
        name: "Brightness",
        role: "level.dimmer",
        type: "number",
        min: 0,
        max: 100,
      }),
    ],
    [
      "alias.0.Lamp.colortemp",
      object({
        name: "Color temperature",
        role: "level.color.temperature",
        type: "number",
      }),
    ],
    [
      "alias.0.Lamp.available",
      object({
        name: "Available",
        role: "indicator.reachable",
        type: "boolean",
      }),
    ],
    [
      "alias.0.Lamp.uptime",
      object({ name: "Uptime", role: "value.interval", type: "number" }),
    ],
  ]),
  variables: [],
};

const lamp = (): TileConfig => ({
  size: { w: 2, h: 2 },
  look: { inactive: { glyph: "lightbulb_outline" } },
  active: {
    source: { kind: "state", stateId: "alias.0.Lamp.SET" },
    op: "truthy",
  },
  slots: [
    {
      kind: "switch",
      source: { kind: "state", stateId: "alias.0.Lamp.SET" },
      label: "Power",
      rules: [{ when: "truthy(power)" }],
    },
    {
      kind: "level",
      source: { kind: "state", stateId: "alias.0.Lamp.brightness" },
      label: "Brightness",
    },
    {
      kind: "level",
      source: { kind: "state", stateId: "alias.0.Lamp.colortemp" },
      label: "Color Temp",
    },
    {
      kind: "badge",
      source: "ago",
      options: { of: "alias.0.Lamp.SET", from: "lc" },
    },
    {
      kind: "badge",
      source: { kind: "state", stateId: "alias.0.Lamp.available" },
      label: "Offline",
      options: { derive: "ago", from: "lc" },
      rules: [{ when: "!isOnline(available)", only: true, tone: "danger" }],
    },
    {
      kind: "value",
      source: { kind: "state", stateId: "alias.0.Lamp.uptime" },
      label: "Uptime",
    },
  ],
});

it("infers Light from the lamp slots", () => {
  expect(inferTemplateType(lamp(), look)).toBe("Light");
});

it("maps state sources back to feature hints", () => {
  const result = collectTileTemplate(lamp(), {
    id: "t1",
    name: "AZFL Light",
    type: "Light",
    look,
  });
  expect(result.omitted).toBe(1); // uptime has no Light feature
  expect(result.template.features.map((feature) => feature.feature)).toEqual([
    "power",
    "brightness",
    "colorTemp",
    "connected",
  ]);
  expect(
    result.template.features.find((feature) => feature.primary)?.feature,
  ).toBe("power");
  expect(result.template.slots.map((slot) => slot.source)).toEqual([
    "power",
    "brightness",
    "colorTemp",
    "ago",
    "connected",
  ]);
  const ago = result.template.slots.find((slot) => slot.source === "ago");
  expect(ago?.options).toMatchObject({ of: "power", from: "lc" });
  const availability = result.template.slots[4];
  expect(availability.options).toMatchObject({ derive: "ago", from: "lc" });
  // The rule's local state name becomes the feature name.
  expect(availability.rules).toEqual([
    { when: "!isOnline(connected)", only: true, tone: "danger" },
  ]);
  expect(result.template.active).toEqual({ source: "power", op: "truthy" });
  expect(result.template.size).toEqual({ w: 2, h: 2 });
  expect(result.template.look?.inactive?.glyph).toBe("lightbulb_outline");
});

it("infers Switch for a power-only tile", () => {
  const tile: TileConfig = {
    slots: [
      {
        kind: "switch",
        source: { kind: "state", stateId: "alias.0.Plug.SET" },
        label: "Power",
      },
    ],
  };
  const objects = new Map<string, any>([
    [
      "alias.0.Plug.SET",
      object({ name: "Plug", role: "switch", type: "boolean" }),
    ],
  ]);
  const plugLook: SourceLook = { ...look, objects };
  expect(inferTemplateType(tile, plugLook)).toBe("Switch");
});

it("maps a device control through its feature", () => {
  const devLook: SourceLook = {
    ...look,
    devices: [
      {
        id: "d1",
        name: "Lamp",
        type: "Light",
        controls: [{ id: "c1", feature: "power", stateId: "alias.0.Lamp.SET" }],
      } as any,
    ],
  };
  const result = collectTileTemplate(
    {
      slots: [
        {
          kind: "switch",
          source: { kind: "control", device: "d1", control: "c1" },
          label: "Power",
        },
      ],
    },
    { id: "t2", name: "Device light", type: "Light", look: devLook },
  );
  expect(result.template.slots[0].source).toBe("power");
});

it("round-trips a saved template into a state tile with its rules", () => {
  const result = collectTileTemplate(lamp(), {
    id: "t1",
    name: "AZFL Light",
    type: "Light",
    look,
  });
  const materialized = materializeTemplateTileFromState(
    result.template,
    {
      ref: "alias.0.Lamp.SET",
      stateId: "alias.0.Lamp.SET",
      object: look.objects.get("alias.0.Lamp.SET"),
    },
    look.objects,
    "power",
  );
  const power = materialized.slots[0];
  expect(power.kind).toBe("switch");
  expect(power.label).toBe("Power");
  expect(power.rules?.length).toBe(1);
  const availability = materialized.slots.find(
    (slot) => slot.options?.derive === "ago",
  );
  expect(availability?.rules).toEqual([
    { when: "!isOnline(connected)", only: true, tone: "danger" },
  ]);
});
