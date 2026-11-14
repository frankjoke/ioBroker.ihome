import { it, expect } from "vitest";
import {
  applyTileSeed,
  materializeTemplateTile,
  materializeTemplateTileFromState,
  preselectedControlIds,
  suggestedSlots,
  slotFromControl,
  slotFromState,
  slotKindForWidget,
  tileSeed,
} from "$lib/config/slot-create";
import { PRESETS } from "$lib/config/presets";
import { labelShown } from "$lib/config/tile-parts";
import type { Control, Device } from "$lib/types/device";
import type { Slot, Template } from "$lib/types/display";

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

const device = (over: Partial<Device> = {}): Device => ({
  id: "dev",
  name: "Dev",
  type: "Light",
  controls: [],
  ...over,
});

it("copies label/min/max/step into the slot, not the unit", () => {
  const control = ctl("c1", "brightness", {
    label: "Brightness",
    common: { min: 0, max: 100, step: 5, unit: "%" },
  });
  const slot = slotFromControl(device(), control);
  expect(slot).toMatchObject({
    kind: "level",
    source: { kind: "control", device: "dev", control: "c1" },
    label: "Brightness",
    options: { min: 0, max: 100, step: 5 },
  });
  // The resolver returns the effective unit; the slot only overrides it.
  expect(slot.unit).toBeUndefined();
});

it("starts a new slot's name in the detail view", () => {
  const slot = slotFromControl(
    device(),
    ctl("c1", "brightness", { label: "Brightness" }),
  );
  // No stored home: the detail row owns the name, never the tile face.
  expect(slot.labelWhere).toBeUndefined();
  expect(labelShown(slot, "tile")).toBe(false);
  expect(labelShown(slot, "modal")).toBe(true);
});

it("gives a control slot its role's glyph, like a raw state does", () => {
  const light = slotFromControl(
    device(),
    ctl("c1", "power", { role: "switch.light" }),
  );
  expect(light.icon).toEqual({ glyph: "power_settings_new" });
  // A role-less boolean still gets a face.
  expect(
    slotFromControl(device(), ctl("c2", "x", { role: "", type: "boolean" }))
      .icon,
  ).toEqual({ glyph: "toggle_on" });
  // A role with no mapping and no boolean type stays bare.
  expect(
    slotFromControl(device(), ctl("c3", "x", { role: "value.string" })).icon,
  ).toBeUndefined();
});

it("lets the control correction decide the slot kind, not the object", () => {
  const device = { id: "d", type: "Switch", controls: [] } as any;
  const slot = slotFromControl(device, {
    id: "c",
    feature: "power",
    writable: true,
    role: "switch",
    states: { "0": "Standby", "1": "Heizung" },
    object: { common: { role: "value", type: "number", states: { "0": "x" } } },
  } as any);
  expect(slot.kind).toBe("enum");
  expect(slot.label).toBeUndefined();
  expect(slot.unit).toBeUndefined();
});

it("keeps only controls the device actually has", () => {
  const light = device({
    type: "Light",
    controls: [ctl("c1", "brightness", { common: { min: 0, max: 100 } })],
  });
  const slots = suggestedSlots(light, PRESETS.Light.slots);
  expect(slots.map((s) => s.kind)).toEqual(["level"]); // no colour/power slot
  expect(slots[0].source).toEqual({
    kind: "control",
    device: light.id,
    control: "c1",
  });
});

it("preselects every control that carries data", () => {
  const light = device({
    type: "Light",
    controls: [
      ctl("power", "power", { stateId: "x.power" }),
      ctl("bright", "brightness", { stateId: "x.bright" }),
      ctl("color", "color", { stateId: "x.color" }),
      ctl("time", "time", { stateId: "x.time" }),
    ],
  });
  expect(preselectedControlIds(light)).toEqual([
    "power",
    "bright",
    "color",
    "time",
  ]);
});

it("skips empty template controls and keeps virtual ones", () => {
  const dev = device({
    type: "Light",
    controls: [
      ctl("empty", "power"),
      ctl("empty2", "brightness"),
      ctl("read", "value", { stateId: "x.read" }),
      ctl("virtual", "computed", {
        kind: "virtual",
        virtual: { expr: "1" },
      }),
    ],
  });
  expect(preselectedControlIds(dev)).toEqual(["read", "virtual"]);
});

it("preselects nothing when no control is bound", () => {
  expect(
    preselectedControlIds(device({ controls: [ctl("a", "power")] })),
  ).toEqual([]);
});

it("uses the state's role/type over the device type's feature", () => {
  const consumption = ctl("c1", "power", {
    object: {
      common: {
        name: "CONSUMPTION",
        role: "value.power.consumption",
        type: "number",
        unit: "Wh",
        write: false,
      },
    },
  } as unknown as Partial<Control>);
  const unitSlot = slotFromControl(device({ type: "Switch" }), consumption);
  expect(unitSlot).toMatchObject({
    kind: "value",
    label: "CONSUMPTION",
  });
  // The unit comes back through the resolver, not the slot document.
  expect(unitSlot.unit).toBeUndefined();

  const power = ctl("c2", "power", {
    object: {
      common: { name: "SET", role: "switch", type: "boolean", write: true },
    },
  } as unknown as Partial<Control>);
  expect(slotFromControl(device({ type: "Switch" }), power).kind).toBe(
    "switch",
  );
});

it("a new tile takes its name, size and glyph from the first control", () => {
  const dev = device({
    id: "brunnen",
    name: "Brunnen",
    type: "Switch",
    controls: [ctl("c1", "power")],
  });
  const slots = [slotFromControl(dev, dev.controls[0])];
  expect(tileSeed(slots, [dev], [])).toEqual({
    title: "Brunnen",
    size: { w: 2, h: 2 },
    icon: "power_settings_new",
  });
});

it("a Custom device takes the face from its first control", () => {
  const battery = device({
    id: "battery",
    name: "Battery",
    type: "Custom",
    controls: [ctl("soc", "soc", { role: "value.battery", type: "number" })],
  });
  const slots = [slotFromControl(battery, battery.controls[0])];
  expect(slots[0].icon?.glyph).toBe("battery_full");
  expect(tileSeed(slots, [battery], []).icon).toBe("battery_full");
});

it("never suggests a hidden control", () => {
  const light = device({
    type: "Light",
    controls: [
      ctl("c1", "power", { hidden: true }),
      ctl("c2", "brightness", { hidden: true, common: { min: 0, max: 100 } }),
    ],
  });
  expect(suggestedSlots(light, PRESETS.Light.slots)).toEqual([]);
});

it("resolves a preset's pick hint to the device's actual control", () => {
  const thermometer = device({
    type: "Thermometer",
    controls: [
      ctl("t1", "temperature", { label: "Temperature" }),
      ctl("h1", "humidity", { label: "Humidity" }),
    ],
  });
  const slots = suggestedSlots(thermometer, PRESETS.Thermometer.slots);
  expect(slots.map((s) => s.kind)).toEqual(["value", "value"]);
  expect(slots.map((s) => s.source)).toEqual([
    { kind: "control", device: "dev", control: "t1" },
    { kind: "control", device: "dev", control: "h1" },
  ]);
  // The hint is dead weight once the source pins the control.
  expect(slots.every((s) => s.options?.pick === undefined)).toBe(true);
  expect(slots[0].label).toBe("Temperature");
});

it("maps a switch control to a switch slot", () => {
  const sw = device({
    type: "Switch",
    controls: [ctl("p", "power", { common: { type: "boolean" } })],
  });
  const slots = suggestedSlots(sw, PRESETS.Switch.slots);
  expect(slots[0]).toMatchObject({
    kind: "switch",
    source: { kind: "control", device: "dev", control: "p" },
  });
});

it("creates a raw-state slot with the state's metadata", () => {
  const object = {
    common: {
      name: "Lamp level",
      type: "number",
      min: 0,
      max: 254,
      step: 1,
      unit: "lvl",
    },
  };
  expect(slotFromState("0_userdata.0.lamp", object, "level")).toEqual({
    kind: "level",
    source: { kind: "state", stateId: "0_userdata.0.lamp" },
    label: "Lamp level",
    unit: "lvl",
    options: { min: 0, max: 254, step: 1 },
  });
});

it("maps widgets to their slot kind", () => {
  expect(slotKindForWidget("switch")).toBe("switch");
  expect(slotKindForWidget("level")).toBe("level");
  expect(slotKindForWidget("color")).toBe("color");
  expect(slotKindForWidget("enum")).toBe("enum");
  expect(slotKindForWidget("button")).toBe("button");
  expect(slotKindForWidget("value")).toBe("value");
});

const power = ctl("c-power", "power");
const brightness = ctl("c-brightness", "brightness");
const light = device({
  id: "lamp",
  name: "Lamp",
  type: "Light",
  template: "u",
  controls: [power, brightness],
});

const template = {
  ...PRESETS.Light,
  id: "u",
  name: "U",
  builtin: false,
  basedOn: "Light",
  features: PRESETS.Light.features,
  active: { source: "power", op: "truthy" },
  look: { active: { glow: "red" } },
} as Template;

it("materialises feature slots and keeps raw state slots", () => {
  const render = {
    ...template,
    features: [
      ...PRESETS.Light.features,
      {
        feature: "missing",
        label: "Missing",
        widget: "value" as const,
        roleHints: [],
      },
    ],
    slots: [
      { kind: "switch", source: "power" },
      { kind: "value", source: { kind: "state", stateId: "hue.0.other" } },
      { kind: "value", source: "missing" },
      { kind: "value", source: "hue.0.raw" },
    ],
  } as Template;
  const result = materializeTemplateTile(render, light, [render]);
  expect(result.slots).toEqual([
    expect.objectContaining({
      kind: "switch",
      source: { kind: "control", device: "lamp", control: "c-power" },
    }),
    expect.objectContaining({
      source: { kind: "state", stateId: "hue.0.other" },
    }),
    expect.objectContaining({ source: "hue.0.raw" }),
  ]);
});

it("rewrites the active feature and drops an unfilled one", () => {
  const withBattery = {
    ...template,
    features: [
      ...PRESETS.Light.features,
      {
        feature: "battery",
        label: "Battery",
        widget: "value" as const,
        roleHints: ["value.battery"],
      },
    ],
  } as Template;
  expect(
    materializeTemplateTile(
      { ...template, active: { source: "power", op: "truthy" } },
      light,
      [template],
    ).active,
  ).toEqual({
    source: { kind: "control", device: "lamp", control: "c-power" },
    op: "truthy",
  });
  expect(
    materializeTemplateTile(
      { ...withBattery, active: { source: "battery", op: "lt", value: "20" } },
      device({ ...light, controls: [power, brightness] }),
      [withBattery],
    ).active,
  ).toBeUndefined();
});

it("tileSeed carries the template active and look", () => {
  const slot: Slot = slotFromControl(light, power);
  const seed = tileSeed([slot], [light], [template]);
  expect(seed.active).toEqual(expect.objectContaining({ op: "truthy" }));
  expect(seed.look).toEqual(
    expect.objectContaining({ active: expect.any(Object) }),
  );
});

it("fills active, look and background from the seed without overwriting", () => {
  const seed = {
    active: { source: "power", op: "truthy" as const },
    look: { active: { glow: "red" } },
    size: { w: 2 as const, h: 2 as const },
    background: { kind: "solid" as const, value: "#000" },
  };
  expect(applyTileSeed({ slots: [] }, seed)).toMatchObject({
    active: seed.active,
    look: seed.look,
    size: seed.size,
    background: seed.background,
  });
  expect(
    applyTileSeed(
      {
        slots: [],
        active: { source: "x", op: "truthy" },
        look: { inactive: { glyph: "x" } },
      },
      seed,
    ).active,
  ).toEqual({ source: "x", op: "truthy" });
  expect(
    applyTileSeed(
      { slots: [], look: { inactive: { glyph: "x" } } },
      { look: { inactive: { color: "red" } } },
    ).look?.inactive,
  ).toEqual({ color: "red", glyph: "x" });
});

it("binds a switch's ago badge to its main switch", () => {
  const sw = device({
    id: "plug",
    name: "Plug",
    type: "Switch",
    controls: [
      ctl("c-power", "power", { stateId: "shelly.1.plug.Relay0.Switch" }),
      ctl("c-connected", "connected", {
        stateId: "shelly.1.plug.available",
      }),
    ],
  });
  const result = materializeTemplateTile(PRESETS.Switch, sw, [PRESETS.Switch]);
  const ago = result.slots.find((slot) => slot.source === "ago");
  expect(ago?.options).toMatchObject({
    of: "shelly.1.plug.Relay0.Switch",
    from: "lc",
  });
  expect(
    result.slots.some(
      (slot) =>
        slot.options?.derive === "ago" &&
        typeof slot.source === "object" &&
        slot.source.kind === "control",
    ),
  ).toBe(true);
  const offline = result.slots.find(
    (slot) => slot.options?.derive === "ago" && slot.rules?.length,
  );
  expect(offline?.rules).toEqual([
    { when: "!isOnline(connected)", only: true, tone: "danger" },
  ]);
});

it("drops a switch's availability badge when there is no connected control", () => {
  const sw = device({
    id: "plug2",
    name: "Plug",
    type: "Switch",
    controls: [ctl("c-power", "power", { stateId: "x.Switch" })],
  });
  const result = materializeTemplateTile(PRESETS.Switch, sw, [PRESETS.Switch]);
  expect(result.slots.some((slot) => slot.options?.derive === "ago")).toBe(
    false,
  );
});

it("builds a Light tile from a state without creating a device", () => {
  const main = {
    ref: "alias.0.Lamp.SET",
    stateId: "alias.0.Lamp.SET",
    object: {
      type: "state",
      common: { name: "Lamp", role: "switch.light", type: "boolean" },
    },
  };
  const objects = new Map<string, any>([
    ["alias.0.Lamp", { type: "channel", common: { name: "Lamp" } }],
    ["alias.0.Lamp.SET", main.object],
    [
      "alias.0.Lamp.brightness",
      {
        type: "state",
        common: {
          name: "Brightness",
          role: "level.dimmer",
          type: "number",
          min: 0,
          max: 100,
        },
      },
    ],
    [
      "alias.0.Lamp.colortemp",
      {
        type: "state",
        common: {
          name: "Color temperature",
          role: "level.color.temperature",
          type: "number",
        },
      },
    ],
    [
      "alias.0.Lamp.available",
      {
        type: "state",
        common: {
          name: "Available",
          role: "indicator.reachable",
          type: "boolean",
        },
      },
    ],
  ]);
  const result = materializeTemplateTileFromState(
    PRESETS.Light,
    main,
    objects,
    "power",
  );
  // The same slots the device tile has: power, dimmer, colour temperature,
  // ago and availability ago; colour and battery have no state here.
  expect(result.slots.map((slot) => slot.kind)).toEqual([
    "switch",
    "level",
    "level",
    "badge",
    "badge",
  ]);
  expect(result.slots[0].source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.SET",
  });
  expect(result.slots[2].source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.colortemp",
  });
  // The same captions the device tile gets from its feature controls.
  expect(result.slots.map((slot) => slot.label)).toEqual([
    "Power",
    "Brightness",
    "Color Temp",
    undefined,
    "Connected",
  ]);
  const ago = result.slots.find((slot) => slot.source === "ago");
  expect(ago?.options).toMatchObject({
    of: "alias.0.Lamp.SET",
    from: "lc",
  });
  const offline = result.slots.find((slot) => slot.options?.derive === "ago");
  expect(offline?.source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.available",
  });
  expect(offline?.rules).toEqual([
    { when: "!isOnline(connected)", only: true, tone: "danger" },
  ]);
  expect(result.title).toBe("Lamp");
  expect(result.active).toMatchObject({
    source: { kind: "state", stateId: "alias.0.Lamp.SET" },
    op: "truthy",
  });
});
