import { it, expect } from "vitest";
import {
  PRESETS,
  mergeSlots,
  parseTemplateRegistry,
  presetForType,
  primaryControl,
  resolveTemplate,
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

it("carries the spec's preset sizes", () => {
  expect(PRESETS.Switch.size).toEqual({ w: 1, h: 1 });
  expect(PRESETS.Thermostat.size).toEqual({ w: 2, h: 1 });
  expect(PRESETS.Blind.size).toEqual({ w: 2, h: 1 });
  expect(PRESETS.AC.size).toEqual({ w: 2, h: 2 });
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
