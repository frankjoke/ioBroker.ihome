import { it, expect } from "vitest";
import {
  COMMON_FEATURES,
  DEVICE_FEATURES,
  featureCatalog,
  suggestFeature,
  roleLabel,
  stateLabel,
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

it("uses the last state id segment as a control label", () => {
  expect(
    stateLabel("mqtt.0.FJTor2.openDoor", {
      common: { role: "variable", name: "FJTor2/openDoor" },
    }),
  ).toBe("openDoor");
  expect(stateLabel("MyVar")).toBe("MyVar");
  expect(stateLabel("", { common: { name: "Name" } })).toBe("Name");
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

it("levelRange: the effective metadata wins over a copied slot range", () => {
  // The control correction is the truth; copied slot ranges only fill gaps.
  expect(
    levelRange({ min: 0, max: 100, step: 1 }, { min: 10, max: 90, step: 10 }),
  ).toEqual({ min: 0, max: 100, step: 1 });
  // A slot range fills a knob the metadata does not name.
  expect(levelRange({ min: 0, max: 100 }, { step: 10 })).toEqual({
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

it("marks the primary feature per built-in type", () => {
  expect(
    DEVICE_FEATURES.Light.find((f) => f.feature === "power")?.primary,
  ).toBe(true);
  expect(
    DEVICE_FEATURES.Thermostat.find((f) => f.feature === "setpoint")?.primary,
  ).toBe(true);
  expect(
    DEVICE_FEATURES.Thermometer.find((f) => f.feature === "temperature")
      ?.primary,
  ).toBe(true);
});

it("maps low-battery indicators to the battery feature", () => {
  expect(
    COMMON_FEATURES.find((f) => f.feature === "battery")?.roleHints,
  ).toContain("indicator.lowbat");
});

it("does not let a broad level hint swallow colour states", () => {
  expect(
    DEVICE_FEATURES.Light.find((f) => f.feature === "brightness")?.roleHints,
  ).not.toContain("level");
});

it("adds common extras without duplicating the type features", () => {
  const keys = featureCatalog("Light").map((f) => f.feature);
  expect(keys).toEqual(
    expect.arrayContaining(["power", "battery", "connected"]),
  );
  expect(new Set(keys).size).toBe(keys.length);
  expect(COMMON_FEATURES.map((f) => f.feature)).toEqual([
    "battery",
    "connected",
  ]);
});
