import { expect, it } from "vitest";
import { PRESETS } from "./presets";
import { materializeTemplateTile, suggestedSlots } from "./slot-create";
import type { Control, Device } from "$lib/types/device";

const powerControl: Control = {
  id: "c-power",
  feature: "power",
  stateId: "hue.0.lamp.on",
  writable: true,
};

function deviceWithControls(controls: Control[]): Device {
  return {
    id: "lamp",
    name: "Lamp",
    type: "Light",
    controls,
  };
}

it("makes the Light preset a complete example", () => {
  const keys = PRESETS.Light.features.map((f) => f.feature);
  expect(keys).toEqual(expect.arrayContaining(["battery", "connected"]));
  expect(
    PRESETS.Light.features.find((f) => f.feature === "power")?.primary,
  ).toBe(true);
  expect(PRESETS.Light.active).toEqual({ source: "power", op: "truthy" });
  expect(PRESETS.Light.slots.some((s) => s.source === "battery")).toBe(true);
  expect(PRESETS.Light.slots.some((s) => s.source === "connected")).toBe(true);
});

it("drops the optional badges when the device has no such controls", () => {
  const slots = suggestedSlots(
    deviceWithControls([powerControl]),
    PRESETS.Light.slots,
  );
  expect(
    slots.some(
      (slot) => slot.label === "Battery" || slot.label === "Connected",
    ),
  ).toBe(false);
});

it("includes the colour-temperature control in the Light template", () => {
  const colorTemp: Control = {
    id: "c-ct",
    feature: "colorTemp",
    stateId: "zigbee.0.lamp.colortemp",
    writable: true,
  };
  const light = deviceWithControls([powerControl, colorTemp]);
  const slots = suggestedSlots(light, PRESETS.Light.slots);
  expect(
    slots.some(
      (slot) =>
        typeof slot.source === "object" &&
        slot.source.kind === "control" &&
        slot.source.control === "c-ct",
    ),
  ).toBe(true);
  const materialized = materializeTemplateTile(PRESETS.Light, light, [
    PRESETS.Light,
  ]);
  expect(
    materialized.slots.some(
      (slot) =>
        typeof slot.source === "object" &&
        slot.source.kind === "control" &&
        slot.source.control === "c-ct",
    ),
  ).toBe(true);
});
