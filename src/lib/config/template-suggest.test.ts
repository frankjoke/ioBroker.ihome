import { expect, it } from "vitest";
import {
  aliasBaseIds,
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

it("keeps a clear role match when another feature falls back to the same type", () => {
  const dimmer = new Map<string, any>([
    ["hue.0.lamp.1", { type: "channel", common: { name: "Lamp" } }],
    ["hue.0.lamp.1.on", state("switch.light", "boolean")],
    ["hue.0.lamp.1.brightness", state("level.dimmer", "number")],
  ]);
  const result = autoFillTemplate(PRESETS.Light, main, dimmer);
  expect(
    result.fills.find((f) => f.feature.feature === "brightness")?.stateId,
  ).toBe("hue.0.lamp.1.brightness");
  expect(
    result.fills.find((f) => f.feature.feature === "colorTemp")?.stateId,
  ).toBeUndefined();
  expect(result.conflicts).not.toContain("brightness");
});

it("offers Switch and Button for a plain boolean among all presets", () => {
  const ids = suggestTemplatesForState(
    { stateId: "x.b", object: state("state", "boolean") },
    Object.values(PRESETS),
  ).map((suggestion) => suggestion.template.id);
  expect(ids.slice(0, 2).sort()).toEqual(["Button", "Switch"]);
});

it("can anchor a secondary feature and auto-fill the primary", () => {
  const secondary = {
    ref: "hue.0.lamp.1.t1",
    stateId: "hue.0.lamp.1.t1",
    object: objects.get("hue.0.lamp.1.t1"),
  };
  const result = autoFillTemplate(
    lightTemplate(),
    secondary,
    objects,
    "temperature",
  );
  expect(
    result.fills.find((f) => f.feature.feature === "temperature")?.stateId,
  ).toBe("hue.0.lamp.1.t1");
  expect(result.fills.find((f) => f.feature.feature === "power")?.stateId).toBe(
    "hue.0.lamp.1.on",
  );
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
  expect(
    result.fills
      .filter((fill) => fill.conflict)
      .map((fill) => fill.feature.feature),
  ).toEqual(["a", "b"]);
  expect(
    result.fills.every((fill) => !fill.conflict || fill.candidates.length > 0),
  ).toBe(true);
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

it("follows an alias base into its device for the remaining controls", () => {
  const aliasState = {
    type: "state",
    common: {
      role: "switch.light",
      type: "boolean",
      alias: { id: "zigbee.0.cc86.state" },
    },
  };
  const aliasMain = {
    ref: "alias.0.1Stock.FSZLampe.SET",
    stateId: "alias.0.1Stock.FSZLampe.SET",
    object: aliasState,
  };
  const aliasObjects = new Map<string, any>([
    [
      "alias.0.1Stock.FSZLampe",
      { type: "channel", common: { name: "FSZLampe" } },
    ],
    ["alias.0.1Stock.FSZLampe.SET", aliasState],
    ["zigbee.0.cc86", { type: "device", common: { name: "RB 248 T" } }],
    ["zigbee.0.cc86.state", state("switch.light", "boolean")],
    ["zigbee.0.cc86.brightness", state("level.dimmer", "number")],
    ["zigbee.0.cc86.color", state("level.color.rgb", "string")],
    ["zigbee.0.cc86.colorTemp", state("level.color.temperature", "number")],
    ["zigbee.0.cc86.battery", state("value.battery", "number")],
    ["zigbee.0.cc86.connected", state("indicator.reachable", "boolean")],
  ]);
  expect(groupOfState("zigbee.0.cc86.state", aliasObjects, true)).toBe(
    "zigbee.0.cc86",
  );
  expect(groupOfState("zigbee.0.cc86.state", aliasObjects)).toBe("zigbee.0");
  expect(aliasBaseIds(aliasState)).toEqual(["zigbee.0.cc86.state"]);
  const result = autoFillTemplate(PRESETS.Light, aliasMain, aliasObjects);
  expect(
    result.fills.find((f) => f.feature.feature === "brightness")?.stateId,
  ).toBe("zigbee.0.cc86.brightness");
  expect(result.fills.find((f) => f.feature.feature === "color")?.stateId).toBe(
    "zigbee.0.cc86.color",
  );
  expect(
    result.fills.find((f) => f.feature.feature === "battery")?.stateId,
  ).toBe("zigbee.0.cc86.battery");
  expect(
    result.fills.find((f) => f.feature.feature === "connected")?.stateId,
  ).toBe("zigbee.0.cc86.connected");
  expect(result.conflicts).toEqual([]);
});

it("suggests Light for a switch.light state", () => {
  const ids = suggestTemplatesForState(
    {
      stateId: "zigbee.0.cc86.state",
      object: state("switch.light", "boolean"),
    },
    Object.values(PRESETS),
  ).map((suggestion) => suggestion.template.id);
  expect(ids).toContain("Light");
});

it("does not suggest templates for infrastructure states", () => {
  expect(
    suggestTemplatesForState(
      {
        stateId: "zigbee.0.cc86.device_query",
        object: state("button", "boolean"),
      },
      [PRESETS.Button, PRESETS.Switch],
    ),
  ).toEqual([]);
  expect(
    suggestTemplatesForState(
      {
        stateId: "shelly.1.device.enabled",
        object: state("switch.enable", "boolean"),
      },
      [PRESETS.Switch, PRESETS.Light],
    ),
  ).toEqual([]);
});

it("finds connected/battery on the parent device for a Shelly relay", () => {
  const relayMain = {
    ref: "shelly.1.plug.Relay0.Switch",
    stateId: "shelly.1.plug.Relay0.Switch",
    object: state("switch", "boolean"),
  };
  const relayObjects = new Map<string, any>([
    ["shelly.1.plug", { type: "device", common: { name: "Plug" } }],
    ["shelly.1.plug.available", state("indicator.reachable", "boolean")],
    ["shelly.1.plug.Relay0", { type: "channel", common: { name: "Relay0" } }],
    ["shelly.1.plug.Relay0.Switch", state("switch", "boolean")],
    ["shelly.1.plug.Relay0.Power", state("value.power", "number")],
  ]);
  expect(groupOfState(relayMain.stateId, relayObjects)).toBe(
    "shelly.1.plug.Relay0",
  );
  const result = autoFillTemplate(PRESETS.Switch, relayMain, relayObjects);
  expect(
    result.fills.find((f) => f.feature.feature === "connected")?.stateId,
  ).toBe("shelly.1.plug.available");
  expect(result.fills.find((f) => f.feature.feature === "power")?.stateId).toBe(
    "shelly.1.plug.Relay0.Switch",
  );
});
