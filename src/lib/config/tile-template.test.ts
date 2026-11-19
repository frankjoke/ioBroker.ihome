import { expect, it } from "vitest";
import {
  collectTileTemplate,
  inferTemplateType,
  tileSourceCount,
} from "./tile-template";
import {
  materializeTemplateTileFromFills,
  materializeTemplateTileFromState,
} from "$lib/config/slot-create";
import type { SourceLook } from "$lib/config/slot-source";
import type { TemplateReference } from "$lib/config/template-reference";
import type { SlotSource, Template, TileConfig } from "$lib/types/display";

const object = (common: Record<string, unknown>) => ({ type: "state", common });

const controlSource = (device: string, control: string): SlotSource => ({
  kind: "control",
  device,
  control,
});
const stateSource = (stateId: string): SlotSource => ({
  kind: "state",
  stateId,
});

it("counts a tile's distinct source origins", () => {
  expect(tileSourceCount(undefined)).toBe(0);
  // Several states from one device stay one origin.
  expect(
    tileSourceCount({
      slots: [
        { kind: "value", source: stateSource("alias.0.Lamp.SET") },
        { kind: "level", source: stateSource("alias.0.Lamp.brightness") },
      ],
    }),
  ).toBe(1);
  expect(
    tileSourceCount({
      slots: [
        { kind: "value", source: controlSource("lamp", "power") },
        { kind: "level", source: controlSource("lamp", "brightness") },
      ],
    }),
  ).toBe(1);
  expect(
    tileSourceCount({
      slots: [
        { kind: "value", source: controlSource("lamp", "power") },
        { kind: "value", source: controlSource("sensor", "temperature") },
      ],
    }),
  ).toBe(2);
  // A raw state is its own origin next to a device control.
  expect(
    tileSourceCount({
      active: { source: controlSource("lamp", "power"), op: "truthy" },
      slots: [{ kind: "value", source: stateSource("alias.0.Lamp.SET") }],
    }),
  ).toBe(2);
});

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

it("maps state sources to roles with their repaired fields", () => {
  const result = collectTileTemplate(lamp(), {
    id: "t1",
    name: "AZFL Light",
    type: "Light",
    look,
  });
  expect(result.omitted).toBe(0);
  expect(result.template.features).toEqual([]);
  expect(result.template.roles).toEqual([
    "switch_light",
    "level_dimmer",
    "level_color_temperature",
    "indicator_reachable",
    "value_interval",
  ]);
  expect(result.template.slots.map((slot) => slot.source)).toEqual([
    "switch_light",
    "level_dimmer",
    "level_color_temperature",
    "ago",
    "indicator_reachable",
    "value_interval",
  ]);
  expect(result.template.slots[0].repair).toMatchObject({
    kind: "repair",
    name: "switch_light",
    label: "Power",
    role: "switch.light",
    type: "boolean",
  });
  const ago = result.template.slots.find((slot) => slot.source === "ago");
  expect(ago?.options).toMatchObject({ of: "switch_light", from: "lc" });
  const availability = result.template.slots[4];
  expect(availability.options).toMatchObject({ derive: "ago", from: "lc" });
  // The rule's local state name becomes the role it is bound to.
  expect(availability.rules).toEqual([
    { when: "!isOnline(indicator_reachable)", only: true, tone: "danger" },
  ]);
  expect(result.template.active).toEqual({
    source: "switch_light",
    op: "truthy",
  });
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

it("maps a device control to its widget role", () => {
  const devLook: SourceLook = {
    ...look,
    devices: [
      {
        id: "d1",
        name: "Lamp",
        type: "Light",
        controls: [
          {
            id: "c1",
            feature: "power",
            stateId: "alias.0.Lamp.SET",
            available: true,
            meta: { role: "switch.light", type: "boolean" },
          },
        ],
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
  expect(result.template.slots[0].source).toBe("switch_light");
  expect(result.template.slots[0].repair).toMatchObject({
    name: "switch_light",
    label: "Power",
    role: "switch.light",
  });
});

it("keeps the border and padding options", () => {
  const result = collectTileTemplate(
    { ...lamp(), border: false, padding: false },
    { id: "t3", name: "Bare light", type: "Light", look },
  );
  expect(result.template.border).toBe(false);
  expect(result.template.padding).toBe(false);
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
  expect(materialized.border).toBe(false);
  expect(materialized.padding).toBe(false);
});

// A three-role tile: temperature, humidity and a switch, as saved from a
// weather-ish tile. Roles come from the object roles, else the widget class.
const roleLook: SourceLook = {
  devices: [],
  states: new Map(),
  objects: new Map<string, any>([
    [
      "home.temperature",
      object({
        name: "Temperature",
        role: "temperature",
        type: "number",
        unit: "°C",
        min: -10,
        max: 40,
        step: 0.5,
        read: true,
      }),
    ],
    [
      "home.humidity",
      object({
        name: "Humidity",
        role: "humidity",
        type: "number",
        unit: "%",
        min: 0,
        max: 100,
        read: true,
      }),
    ],
    [
      "home.switch",
      object({
        name: "Lamp",
        role: "switch",
        type: "boolean",
        read: true,
        write: true,
      }),
    ],
  ]),
  variables: [],
};

const climateTile = (): TileConfig => ({
  active: {
    source: { kind: "state", stateId: "home.switch" },
    op: "truthy",
  },
  slots: [
    {
      kind: "value",
      source: { kind: "state", stateId: "home.temperature" },
      label: "Temperature",
    },
    {
      kind: "value",
      source: { kind: "state", stateId: "home.humidity" },
      label: "Humidity",
    },
    {
      kind: "switch",
      source: { kind: "state", stateId: "home.switch" },
      label: "Lamp",
      rules: [{ when: "truthy(Lamp)" }],
    },
  ],
});

const climateTemplate = () =>
  collectTileTemplate(climateTile(), {
    id: "climate",
    name: "Climate",
    type: "Custom",
    look: roleLook,
  }).template;

it("saves a role per bound source slot with the repaired fields", () => {
  const result = collectTileTemplate(climateTile(), {
    id: "climate",
    name: "Climate",
    type: "Custom",
    look: roleLook,
  });
  expect(result.template.roles).toEqual(["temperature", "humidity", "switch"]);
  expect(result.template.slots.map((slot) => slot.source)).toEqual([
    "temperature",
    "humidity",
    "switch",
  ]);
  expect(result.template.slots[0].repair).toMatchObject({
    kind: "repair",
    name: "temperature",
    label: "Temperature",
    unit: "°C",
    type: "number",
    role: "temperature",
    min: -10,
    max: 40,
    step: 0.5,
    read: true,
  });
  expect(result.template.slots[2].repair).toMatchObject({
    name: "switch",
    role: "switch",
    write: true,
  });
  // Slot rules name the role, so the created override's name resolves them.
  expect(result.template.slots[2].rules).toEqual([{ when: "truthy(switch)" }]);
  expect(result.template.active).toEqual({ source: "switch", op: "truthy" });
});

const climateFills = () => {
  const objects = new Map<string, any>([
    [
      "fresh.temperature",
      object({
        name: "Fresh temperature",
        role: "temperature",
        type: "number",
      }),
    ],
    [
      "fresh.humidity",
      object({ name: "Fresh humidity", role: "humidity", type: "number" }),
    ],
    [
      "fresh.switch",
      object({ name: "Fresh lamp", role: "switch", type: "boolean" }),
    ],
  ]);
  const reference = (id: string) => ({
    ref: id,
    stateId: id,
    object: objects.get(id),
  });
  return {
    objects,
    reference,
    fills: new Map<string, TemplateReference>([
      ["temperature", reference("fresh.temperature")],
      ["humidity", reference("fresh.humidity")],
      ["switch", reference("fresh.switch")],
    ]),
  };
};

it("binds role fills and creates one override per repaired state", () => {
  const { fills, reference, objects } = climateFills();
  const calls: { stateId: string; name: string }[] = [];
  const result = materializeTemplateTileFromFills(
    climateTemplate(),
    fills,
    reference("fresh.temperature"),
    (stateId, repair) => {
      calls.push({ stateId, name: repair.name });
      return { id: `ov-${repair.name}`, name: repair.name };
    },
  );
  expect(calls).toEqual([
    { stateId: "fresh.temperature", name: "temperature" },
    { stateId: "fresh.humidity", name: "humidity" },
    { stateId: "fresh.switch", name: "switch" },
  ]);
  expect(result.slots.map((slot) => slot.source)).toEqual([
    { kind: "state", stateId: "fresh.temperature", override: "ov-temperature" },
    { kind: "state", stateId: "fresh.humidity", override: "ov-humidity" },
    { kind: "state", stateId: "fresh.switch", override: "ov-switch" },
  ]);
  // The template-only repair never reaches the tile.
  expect(result.slots.every((slot) => slot.repair === undefined)).toBe(true);
  expect(result.slots[0].label).toBe("Temperature");
  // `switch` is a JS reserved word, so the tile's rule scope sanitizes it to
  // `switch2`; the materialised rule must name the local the tile builds.
  expect(result.slots[2].rules).toEqual([{ when: "truthy(switch2)" }]);
  expect(objects.size).toBe(3);
});

it("drops unbound roles and never recreates a picked override", () => {
  const { fills, reference } = climateFills();
  fills.delete("humidity");
  fills.set("temperature", {
    ...reference("fresh.temperature"),
    overrideId: "kept",
  });
  const calls: string[] = [];
  const result = materializeTemplateTileFromFills(
    climateTemplate(),
    fills,
    reference("fresh.temperature"),
    (stateId, repair) => {
      calls.push(stateId);
      return { id: "new", name: repair.name };
    },
  );
  expect(result.slots.map((slot) => slot.source)).toEqual([
    { kind: "state", stateId: "fresh.temperature", override: "kept" },
    { kind: "state", stateId: "fresh.switch", override: "new" },
  ]);
  expect(calls).toEqual(["fresh.switch"]);
});

it("creates one override per state even when two roles share it", () => {
  const { reference, objects } = climateFills();
  const shared = reference("fresh.temperature");
  const fills = new Map([
    ["temperature", shared],
    ["humidity", shared],
    ["switch", reference("fresh.switch")],
  ]);
  const calls: string[] = [];
  const result = materializeTemplateTileFromFills(
    climateTemplate(),
    fills,
    shared,
    (stateId, repair) => {
      calls.push(stateId);
      return { id: `ov-${stateId}`, name: repair.name };
    },
  );
  expect(calls).toEqual(["fresh.temperature", "fresh.switch"]);
  expect(result.slots[0].source).toEqual({
    kind: "state",
    stateId: "fresh.temperature",
    override: "ov-fresh.temperature",
  });
  expect(result.slots[1].source).toEqual(result.slots[0].source);
  expect(objects.get("fresh.temperature")?.common.role).toBe("temperature");
});

it("round-trips a saved template into a state tile with resolvable rules", () => {
  const result = collectTileTemplate(lamp(), {
    id: "t1",
    name: "AZFL Light",
    type: "Light",
    look,
  });
  const calls: string[] = [];
  const materialized = materializeTemplateTileFromState(
    result.template,
    {
      ref: "alias.0.Lamp.SET",
      stateId: "alias.0.Lamp.SET",
      object: look.objects.get("alias.0.Lamp.SET"),
    },
    look.objects,
    "switch_light",
    [],
    (_stateId, repair) => {
      calls.push(repair.name);
      return { id: `ov-${repair.name}`, name: repair.name };
    },
  );
  expect(calls).toEqual([
    "switch_light",
    "level_dimmer",
    "level_color_temperature",
    "indicator_reachable",
    "value_interval",
  ]);
  const power = materialized.slots[0];
  expect(power.kind).toBe("switch");
  expect(power.label).toBe("Power");
  expect(power.rules?.length).toBe(1);
  expect(power.source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.SET",
    override: "ov-switch_light",
  });
  expect(materialized.slots.every((slot) => slot.repair === undefined)).toBe(
    true,
  );
  const availability = materialized.slots.find(
    (slot) => slot.options?.derive === "ago",
  );
  // The rule names the override the apply created, so the tile's scope has it.
  expect(availability?.rules).toEqual([
    { when: "!isOnline(indicator_reachable)", only: true, tone: "danger" },
  ]);
});

it("rewrites a rule to the sanitized local of a renamed repair", () => {
  const template = {
    id: "r",
    name: "Rule template",
    type: "Custom",
    roles: ["power"],
    features: [],
    slots: [
      {
        kind: "value",
        source: "power",
        rules: [{ when: "truthy(power)" }],
        repair: { kind: "repair", name: "power" },
      },
    ],
  } as unknown as Template;
  const fill = {
    ref: "fresh.power",
    stateId: "fresh.power",
    object: object({ name: "Power", role: "value.power", type: "number" }),
  };
  const result = materializeTemplateTileFromFills(
    template,
    new Map([["power", fill]]),
    fill,
    () => ({ id: "new", name: "power2" }),
  );
  expect(result.slots[0].source).toEqual({
    kind: "state",
    stateId: "fresh.power",
    override: "new",
  });
  expect(result.slots[0].rules).toEqual([{ when: "truthy(power2)" }]);
});

it("rewrites a rule to a reused override's sanitized local", () => {
  const template = {
    id: "r",
    name: "Rule template",
    type: "Custom",
    roles: ["power"],
    features: [],
    slots: [
      {
        kind: "value",
        source: "power",
        rules: [{ when: "truthy(power)" }],
        repair: { kind: "repair", name: "power" },
      },
    ],
  } as unknown as Template;
  const fill = {
    ref: "fresh.power",
    stateId: "fresh.power",
    object: object({ name: "Power", role: "value.power", type: "number" }),
    overrideId: "kept",
    overrideName: "Power (W)",
  };
  const result = materializeTemplateTileFromFills(
    template,
    new Map([["power", fill]]),
    fill,
  );
  expect(result.slots[0].source).toEqual({
    kind: "state",
    stateId: "fresh.power",
    override: "kept",
  });
  expect(result.slots[0].rules).toEqual([{ when: "truthy(power_w)" }]);
});
