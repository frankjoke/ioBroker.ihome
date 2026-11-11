import { it, expect } from "vitest";
import {
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

it("preselects the recipe's bound controls, not every control", () => {
  const light = device({
    type: "Light",
    controls: [
      ctl("power", "power", { stateId: "x.power" }),
      ctl("bright", "brightness", { stateId: "x.bright" }),
      ctl("color", "color", { stateId: "x.color" }),
      ctl("time", "time", { stateId: "x.time" }),
    ],
  });
  expect(preselectedControlIds(light, PRESETS.Light.slots)).toEqual([
    "power",
    "bright",
    "color",
  ]);
});

it("skips empty template controls and falls back to the first bound one", () => {
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
  // The recipe names power/brightness, but they carry no data.
  expect(preselectedControlIds(dev, PRESETS.Light.slots)).toEqual(["read"]);
  expect(preselectedControlIds(dev, [])).toEqual(["read"]);
});

it("preselects nothing when no control is bound", () => {
  expect(
    preselectedControlIds(device({ controls: [ctl("a", "power")] }), []),
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
