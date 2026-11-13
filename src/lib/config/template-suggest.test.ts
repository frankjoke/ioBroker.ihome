import { expect, it } from "vitest";
import {
  autoFillTemplate,
  groupOfState,
  suggestTemplatesForState,
} from "./template-suggest";
import { PRESETS } from "./template-ops";
import type { FeatureDef } from "./features";
import type { Template } from "$lib/types/display";

function state(role: string, type: string) {
  return { type: "state", common: { role, type } };
}

function feature(
  name: string,
  roleHints: string[],
  overrides: Partial<FeatureDef> = {},
): FeatureDef {
  return {
    feature: name,
    label: name[0].toUpperCase() + name.slice(1),
    widget: "value",
    roleHints,
    ...overrides,
  };
}

const main = {
  ref: "hue.0.lamp.1.on",
  stateId: "hue.0.lamp.1.on",
  object: state("switch.light", "boolean"),
};

const objects = new Map<string, any>([
  ["hue.0.lamp.1", { type: "channel", common: { name: "Lamp" } }],
  ["hue.0.lamp.1.on", state("switch.light", "boolean")],
  ["hue.0.lamp.1.brightness", state("level.dimmer", "number")],
  ["hue.0.lamp.1.t1", state("value.temperature", "number")],
  ["hue.0.lamp.1.t2", state("value.temperature", "number")],
  ["hue.0.lamp.1.battery", state("value.battery", "number")],
]);

function lightTemplate(): Template {
  return {
    ...PRESETS.Light,
    features: [
      feature("power", ["switch.light"], { widget: "switch", primary: true }),
      feature("brightness", ["level.dimmer"], { widget: "level" }),
      feature("battery", ["value.battery"]),
      feature("connected", ["indicator.connected"], { required: true }),
      feature("temperature", ["value.temperature"]),
    ],
  };
}

it("groups by the nearest channel and falls back to the adapter", () => {
  expect(groupOfState("hue.0.lamp.1.on", objects)).toBe("hue.0.lamp.1");
  expect(groupOfState("hue.0.lamp.1.on", new Map())).toBe("hue.0");
});

it("auto-fills unique role matches and reports ambiguity/required", () => {
  const result = autoFillTemplate(lightTemplate(), main, objects);
  expect(
    result.fills.find((f) => f.feature.feature === "brightness")?.stateId,
  ).toBe("hue.0.lamp.1.brightness");
  expect(
    result.fills.find((f) => f.feature.feature === "temperature")?.ambiguous,
  ).toBe(true);
  expect(result.missingRequired).toContain("connected");
  expect(result.conflicts).toEqual([]);
});

it("reports a conflict when two features resolve to one state", () => {
  const template = {
    ...PRESETS.Light,
    features: [
      feature("power", ["switch.light"], { widget: "switch", primary: true }),
      feature("a", ["value.temperature"]),
      feature("b", ["value.temperature"]),
    ],
  } as Template;
  const conflictObjects = new Map(
    [...objects].filter(([id]) => id !== "hue.0.lamp.1.t2"),
  );
  const result = autoFillTemplate(template, main, conflictObjects);
  expect(result.conflicts).toEqual(["a", "b"]);
});

it("suggests the temperature templates and both boolean templates", () => {
  const temperature = {
    stateId: "x.t",
    object: state("value.temperature", "number"),
  };
  expect(
    suggestTemplatesForState(temperature, [
      PRESETS.Thermometer,
      PRESETS.Thermostat,
      PRESETS.Switch,
      PRESETS.Button,
    ]).map((s) => s.template.id),
  ).toEqual(["Thermometer", "Thermostat"]);

  const setpoint = {
    stateId: "x.s",
    object: state("level.temperature", "number"),
  };
  expect(
    suggestTemplatesForState(setpoint, [
      PRESETS.Thermometer,
      PRESETS.Thermostat,
    ]).map((s) => s.template.id),
  ).toEqual(["Thermostat"]);

  const bool = { stateId: "x.b", object: state("state", "boolean") };
  expect(
    suggestTemplatesForState(bool, [PRESETS.Switch, PRESETS.Button])
      .map((s) => s.template.id)
      .sort(),
  ).toEqual(["Button", "Switch"]);
});
