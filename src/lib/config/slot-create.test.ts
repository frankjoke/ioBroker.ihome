import { it, expect } from "vitest";
import {
  suggestedSlots,
  slotFromControl,
  slotFromState,
  slotKindForWidget,
} from "$lib/config/slot-create";
import { PRESETS } from "$lib/config/presets";
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

it("copies label/unit/min/max/step into the slot", () => {
  const control = ctl("c1", "brightness", {
    label: "Brightness",
    common: { min: 0, max: 100, step: 5, unit: "%" },
  });
  expect(slotFromControl(device(), control)).toMatchObject({
    kind: "level",
    source: { kind: "control", device: "dev", control: "c1" },
    label: "Brightness",
    unit: "%",
    options: { min: 0, max: 100, step: 5 },
  });
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
