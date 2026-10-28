import { it, expect } from "vitest";
import {
  DEVICE_FEATURES,
  suggestFeature,
  suggestDeviceType,
  suggestDeviceName,
  roleLabel,
  widgetFor,
  featureDef,
  featureForType,
  levelRange,
} from "$lib/config/features";

it("takes the role tail, capitalised, as the label", () => {
  expect(roleLabel({ common: { role: "value.humidity" } })).toBe("Humidity");
  expect(roleLabel({ common: { role: "switch.light" } })).toBe("Light");
});
it("handles a single-segment role", () => {
  expect(roleLabel({ common: { role: "switch" } })).toBe("Switch");
});
it("returns empty when there is no role", () => {
  expect(roleLabel({ common: {} })).toBe("");
});

it("names a device Room.Type", () => {
  expect(suggestDeviceName("Thermometer", "Bad", "TemperaturBad", false)).toBe(
    "Bad.Thermometer",
  );
});
it("appends the superstate when disambiguating", () => {
  expect(suggestDeviceName("Thermometer", "Bad", "TemperaturBad", true)).toBe(
    "Bad.Thermometer.TemperaturBad",
  );
});
it("omits the room when absent", () => {
  expect(suggestDeviceName("Switch", "", "", false)).toBe("Switch");
});
it("omits the superstate when absent", () => {
  expect(suggestDeviceName("Thermometer", "Bad", "", true)).toBe(
    "Bad.Thermometer",
  );
});

it("suggests Light for a switch.light role", () => {
  expect(suggestDeviceType({ common: { role: "switch.light" } })).toBe("Light");
});
it("uses a parent folder's light role", () => {
  expect(
    suggestDeviceType({ common: { role: "switch" } }, [
      { common: { role: "light" } },
    ]),
  ).toBe("Light");
});
it("suggests Switch for a plain boolean", () => {
  expect(suggestDeviceType({ common: { type: "boolean" } })).toBe("Switch");
});
it("suggests Motion for a sensor.motion role", () => {
  expect(
    suggestDeviceType({ common: { type: "boolean", role: "sensor.motion" } }),
  ).toBe("Motion");
});
it("has a Motion feature", () => {
  expect(DEVICE_FEATURES.Motion?.[0]?.feature).toBe("motion");
});
it("suggests Thermometer for a temperature role", () => {
  expect(suggestDeviceType({ common: { role: "value.temperature" } })).toBe(
    "Thermometer",
  );
});
it("suggests Thermostat for a setpoint role", () => {
  expect(suggestDeviceType({ common: { role: "level.temperature" } })).toBe(
    "Thermostat",
  );
});
it("falls back to Value for a bare number", () => {
  expect(suggestDeviceType({ common: { type: "number" } })).toBe("Value");
});
it("falls back to Custom for a string", () => {
  expect(suggestDeviceType({ common: { type: "string" } })).toBe("Custom");
});

it("suggests brightness for a level-role light", () => {
  expect(
    suggestFeature(
      { common: { role: "level.dimmer", type: "number" } },
      "Light",
    ),
  ).toBe("brightness");
});
it("suggests power for a boolean switch state", () => {
  expect(
    suggestFeature({ common: { role: "switch", type: "boolean" } }, "Switch"),
  ).toBe("power");
});
it("falls back to value for an unknown role", () => {
  expect(
    suggestFeature(
      { common: { role: "unknown.thing", type: "number" } },
      "Value",
    ),
  ).toBe("value");
});
it("resolves the widget for a known feature", () => {
  expect(widgetFor("Light", "brightness")).toBe("level");
});
it("falls back to the value widget for an unknown feature", () => {
  expect(widgetFor("Switch", "nope")).toBe("value");
});
it("featureDef returns undefined for an unknown feature", () => {
  expect(featureDef("Switch", "nope")).toBeUndefined();
});
it("has a feature table for every device type", () => {
  expect(Object.keys(DEVICE_FEATURES)).toEqual(
    expect.arrayContaining([
      "Switch",
      "Light",
      "Thermostat",
      "Blind",
      "Window",
      "AC",
      "Thermometer",
      "Value",
      "Custom",
    ]),
  );
});

it("featureForType keeps a valid feature and repairs a mismatch", () => {
  // Button has only `press`: a boolean fallback from Custom must not survive.
  expect(featureForType("Button", "power")).toBe("press");
  expect(featureForType("Button", "press")).toBe("press");
  // A switch keeps its power; a light's brightness is valid.
  expect(featureForType("Switch", "power")).toBe("power");
  expect(featureForType("Light", "brightness")).toBe("brightness");
  // The state's role/type suggests the best fitting feature when there is one.
  expect(
    featureForType("Switch", "press", { common: { type: "boolean" } }),
  ).toBe("power");
  expect(
    featureForType("Button", undefined, { common: { role: "button" } }),
  ).toBe("press");
});

it("levelRange: the object's range when the slot sets none", () => {
  expect(levelRange({ min: 0, max: 255, step: 5 })).toEqual({
    min: 0,
    max: 255,
    step: 5,
  });
  expect(levelRange({ min: "0", max: "255", step: "5" })).toEqual({
    min: 0,
    max: 255,
    step: 5,
  });
});

it("levelRange: a slot's own range wins over the object's", () => {
  expect(
    levelRange({ min: 0, max: 100, step: 1 }, { min: 10, max: 90, step: 10 }),
  ).toEqual({ min: 10, max: 90, step: 10 });
  // A partial slot range only overrides the knobs it names.
  expect(levelRange({ min: 0, max: 100, step: 1 }, { step: 10 })).toEqual({
    min: 0,
    max: 100,
    step: 10,
  });
});

it("levelRange: falls back to 0/100/1 and ignores a bad step", () => {
  expect(levelRange({})).toEqual({ min: 0, max: 100, step: 1 });
  expect(levelRange({}, { step: 0 })).toEqual({ min: 0, max: 100, step: 1 });
  expect(levelRange({ step: 2 }, { step: Number.NaN })).toEqual({
    min: 0,
    max: 100,
    step: 2,
  });
});
