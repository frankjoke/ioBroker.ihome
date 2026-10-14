import { it, expect } from "vitest";
import {
  PRESETS,
  mergeSlots,
  parseTemplateRegistry,
  pickControl,
  presetForType,
  primaryControl,
  resolveControl,
  resolveTemplate,
  tileTitle,
} from "$lib/config/template-ops";
import { DEVICE_TYPES } from "$lib/config/features";
import type { Template } from "$lib/types/display";

it("merges slots by kind+source with later winning and rules concatenated", () => {
  const merged = mergeSlots([
    [
      {
        kind: "icon",
        source: "power",
        label: "old",
        rules: [{ when: "!power", color: "grey" }],
      },
    ],
    [
      {
        kind: "icon",
        source: "power",
        label: "new",
        rules: [{ when: "power", color: "amber" }],
      },
    ],
    [{ kind: "value" }],
  ]);
  expect(merged.length).toBe(2);
  expect(merged[0].label).toBe("new");
  expect(merged[0].rules?.map((r) => r.when)).toEqual(["!power", "power"]);
});

it("merges badges per source, not per kind", () => {
  const merged = mergeSlots([
    [
      { kind: "badge", source: "ago" },
      { kind: "badge", source: "offline" },
    ],
    [
      {
        kind: "badge",
        source: "offline",
        rules: [{ when: "1", tone: "danger" }],
      },
    ],
  ]);
  expect(merged.length).toBe(2);
  expect(merged[1].rules?.[0].tone).toBe("danger");
});

it("falls back to the type preset when the template id is unknown", () => {
  const r = resolveTemplate(
    { id: "d", name: "L", type: "Light", controls: [] },
    [],
  );
  expect(r.type).toBe("Light");
  expect(r.slots).toEqual(PRESETS.Light.slots);
});

it("falls back to the type preset when basedOn names a missing preset", () => {
  const user: Template = {
    id: "u1",
    name: "Ghost",
    basedOn: "NoSuchPreset",
    type: "Light",
    features: [],
    slots: [
      { kind: "icon", source: "power", options: { icon: "emoji_objects" } },
    ],
  };
  const r = resolveTemplate(
    { id: "d", name: "L", type: "Light", template: "u1", controls: [] },
    [user],
  );
  expect(r.slots.length).toBeGreaterThan(0);
  expect(r.slots.find((s) => s.kind === "value")).toBeTruthy();
});

it("layers preset, user template and device overrides", () => {
  const user: Template = {
    id: "u1",
    name: "My light",
    basedOn: "Light",
    type: "Light",
    size: { w: 2, h: 1 },
    features: [],
    slots: [
      { kind: "icon", source: "power", options: { icon: "emoji_objects" } },
    ],
  };
  const r = resolveTemplate(
    {
      id: "d",
      name: "L",
      type: "Light",
      template: "u1",
      controls: [],
      slots: [{ kind: "value", label: "W" }],
    },
    [user],
  );
  expect(r.size).toEqual({ w: 2, h: 1 });
  expect(r.slots.find((s) => s.kind === "icon")?.options?.icon).toBe(
    "emoji_objects",
  );
  expect(r.slots.some((s) => s.kind === "value" && s.label === "W")).toBe(true);
});

it("picks a writable switch as the tile's primary control", () => {
  expect(
    primaryControl([{ widget: "value" }, { widget: "switch", writable: true }])
      ?.widget,
  ).toBe("switch");
  expect(
    primaryControl([{ widget: "switch", writable: false }, { widget: "level" }])
      ?.widget,
  ).toBe("level");
  expect(primaryControl([])).toBeUndefined();
});

it("gives every device type a preset", () => {
  for (const t of DEVICE_TYPES) {
    expect(presetForType(t).slots.length).toBeGreaterThanOrEqual(1);
  }
});

it("carries the preset sizes", () => {
  // A readout is one half-module wide and one module high; multi-control
  // devices stay wide.
  expect(PRESETS.Switch.size).toEqual({ w: 1, h: 1 });
  expect(PRESETS.Light.size).toEqual({ w: 1, h: 1 });
  expect(PRESETS.Thermometer.size).toEqual({ w: 1, h: 1 });
  expect(PRESETS.Motion.size).toEqual({ w: 1, h: 1 });
  expect(PRESETS.Thermostat.size).toEqual({ w: 2, h: 1 });
  expect(PRESETS.Blind.size).toEqual({ w: 2, h: 1 });
  expect(PRESETS.AC.size).toEqual({ w: 2, h: 2 });
});

it("dims an idle motion sensor", () => {
  const icon = PRESETS.Motion.slots.find((s) => s.kind === "icon");
  expect(icon?.rules?.map((r) => r.when)).toEqual([
    "truthy(motion)",
    "!truthy(motion)",
  ]);
  expect(icon?.rules?.[1].disabled).toBe(true);
});

it("gives the light its on/off icon rules and the thermometer its battery badge", () => {
  const icon = PRESETS.Light.slots.find((s) => s.kind === "icon");
  expect(icon?.rules?.map((r) => r.when)).toEqual([
    "truthy(power)",
    "!truthy(power)",
  ]);
  expect(
    PRESETS.Thermometer.slots
      .filter((s) => s.kind === "badge")
      .map((s) => s.source),
  ).toEqual(["ago", "offline", "battery"]);
});

it("parses a template registry and rejects junk", () => {
  expect(parseTemplateRegistry(null)).toBeNull();
  expect(parseTemplateRegistry({ templates: "x" })).toBeNull();
  expect(parseTemplateRegistry('{"templates":[]}')?.templates).toEqual([]);
  expect(
    parseTemplateRegistry({ templates: [{ id: "t" }] })?.templates.length,
  ).toBe(1);
  expect(
    parseTemplateRegistry({ val: { templates: [{ id: "t" }] } })?.templates
      .length,
  ).toBe(1);
});

it("resolves an explicit built-in preset id", () => {
  const r = resolveTemplate(
    {
      id: "d",
      name: "D",
      type: "Custom",
      template: "Thermostat",
      controls: [],
    },
    [],
  );
  expect(r.slots).toEqual(PRESETS.Thermostat.slots);
  expect(r.size).toEqual(PRESETS.Thermostat.size);
});

it("rejects a template registry entry that would crash the renderer", () => {
  expect(parseTemplateRegistry({ templates: [null] })).toBeNull();
  expect(
    parseTemplateRegistry({ templates: [{ id: "t" }] })?.templates.length,
  ).toBe(1);
});

it("resolves a slot source feature-first, then id, state id, and finally label", () => {
  const controls = [
    { id: "c1", feature: "value", label: "Battery", stateId: "a.0.BATTERY" },
    { id: "c2", feature: "power", label: "Motion", stateId: "a.0.MOTION" },
  ];
  // feature wins over an id or label that happens to match
  expect(resolveControl(controls, "power")?.id).toBe("c2");
  expect(resolveControl(controls, "c1")?.id).toBe("c1");
  expect(resolveControl(controls, "a.0.MOTION")?.id).toBe("c2");
  // a real device may name the state's *label* and nothing else (Keller.Motion)
  expect(resolveControl(controls, "motion")?.id).toBe("c2");
  expect(resolveControl(controls, "Battery")?.id).toBe("c1");
  expect(resolveControl(controls, "nothing")).toBeUndefined();
  expect(resolveControl(controls, undefined)).toBeUndefined();
});

it("derives a tile title, dropping a trailing device-type suffix", () => {
  expect(tileTitle({ name: "Garten-Pool.Light", type: "Light" })).toBe(
    "Garten-Pool",
  );
  expect(tileTitle({ name: "Bad.Thermometer", type: "Thermometer" })).toBe(
    "Bad",
  );
  expect(tileTitle({ name: "Brunnen", type: "Switch" })).toBe("Brunnen");
  // a name that only looks like a suffix in different case still strips
  expect(tileTitle({ name: "Pool.light", type: "Light" })).toBe("Pool");
  // something unrelated is left alone
  expect(tileTitle({ name: "Keller.Motion", type: "Light" })).toBe(
    "Keller.Motion",
  );
  // an explicit title wins over both
  expect(
    tileTitle({ name: "Garten-Pool.Light", type: "Light", title: "Poollicht" }),
  ).toBe("Poollicht");
});

it("keeps repeated readout slots distinct by index", () => {
  const merged = mergeSlots([
    [
      { kind: "value", options: { index: 1 } },
      { kind: "value", options: { index: 2 } },
    ],
    [{ kind: "value", options: { index: 2 }, unit: "°C" }],
  ]);
  expect(merged.length).toBe(2);
  expect(merged[0].options?.index).toBe(1);
  expect(merged[1].unit).toBe("°C");
});

it("picks a readout by role, wherever it sits in the control order", () => {
  const humidityFirst = [
    { id: "h", role: "value.humidity", unit: "%", label: "Luftfeuchtigkeit" },
    { id: "t", role: "value.temperature", unit: "°C", label: "Temperatur" },
  ];
  const used = new Set<string>();
  // role beats position: temperature first even though humidity is control #1
  expect(pickControl(humidityFirst, "temperature", used)?.id).toBe("t");
  used.add("t");
  expect(pickControl(humidityFirst, "humidity", used)?.id).toBe("h");
});

it("falls back from role to label to unit, and skips used controls", () => {
  const byUnit = [{ id: "u", unit: "°C" }];
  expect(pickControl(byUnit, "temperature", new Set())?.id).toBe("u");
  const byLabel = [{ id: "l", label: "Luftfeuchtigkeit" }];
  expect(pickControl(byLabel, "humidity", new Set())?.id).toBe("l");
  const two = [
    { id: "t1", role: "value.temperature" },
    { id: "t2", role: "value.temperature" },
  ];
  const used = new Set<string>(["t1"]);
  expect(pickControl(two, "temperature", used)?.id).toBe("t2");
  expect(
    pickControl([{ id: "x", unit: "W" }], "humidity", new Set()),
  ).toBeUndefined();
});

it("gives the thermometer preset a fixed readout order", () => {
  const values = PRESETS.Thermometer.slots.filter((s) => s.kind === "value");
  expect(values.map((s) => s.options?.pick)).toEqual([
    "temperature",
    "humidity",
  ]);
});
