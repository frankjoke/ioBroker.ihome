import { it, expect } from "vitest";
import {
  PRESETS,
  mergeSlots,
  parseTemplateRegistry,
  pickControl,
  pickSlotControls,
  presetForType,
  primaryControl,
  resolveControl,
  resolveTemplate,
  slotVisible,
  sourceForControl,
  tileTitle,
} from "$lib/config/template-ops";
import { DEVICE_TYPES } from "$lib/config/features";
import type { Slot, Template } from "$lib/types/display";

it("merges slots by kind+source with later winning and rules concatenated", () => {
  const merged = mergeSlots([
    [
      {
        kind: "value",
        source: "power",
        label: "old",
        rules: [{ when: "!power", color: "grey" }],
      },
    ],
    [
      {
        kind: "value",
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
  // …minus the badges a control-less device cannot feed (spec §6): only `ago`.
  expect(r.slots).toEqual(
    PRESETS.Light.slots.filter((s) => s.kind !== "badge" || s.source === "ago"),
  );
});

it("falls back to the type preset when basedOn names a missing preset", () => {
  const user: Template = {
    id: "u1",
    name: "Ghost",
    basedOn: "NoSuchPreset",
    type: "Light",
    features: [],
    slots: [{ kind: "value", source: "power" }],
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
    slots: [{ kind: "button", label: "Boost" }],
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
  expect(r.slots.some((s) => s.kind === "button" && s.label === "Boost")).toBe(
    true,
  );
  expect(r.slots.some((s) => s.kind === "value" && s.label === "W")).toBe(true);
});

it("keeps a template badge only when the device can feed it (spec §6)", () => {
  const motion = resolveTemplate(
    {
      id: "d",
      name: "Bad.Motion",
      type: "Motion",
      controls: [{ id: "m", feature: "motion", writable: false }],
    },
    [],
  );
  expect(
    motion.slots.filter((s) => s.kind === "badge").map((s) => s.source),
  ).toEqual(["ago"]);

  // Feature and `pick` both count; a device with neither keeps only `ago`.
  const switchBadges = resolveTemplate(
    {
      id: "s",
      name: "S",
      type: "Switch",
      controls: [
        { id: "p", feature: "value", writable: false, label: "Leistung" },
      ],
    },
    [],
  ).slots.filter((s) => s.kind === "badge");
  expect(switchBadges.map((s) => s.options?.pick ?? s.source)).toEqual([
    "power",
    "ago",
  ]);
});

it("never prunes the device's own badge slots", () => {
  const r = resolveTemplate(
    {
      id: "d",
      name: "V",
      type: "Value",
      controls: [{ id: "v", feature: "value", writable: false }],
      slots: [{ kind: "badge", source: "offline" }],
    },
    [],
  );
  expect(
    r.slots.filter((s) => s.kind === "badge").map((s) => s.source),
  ).toEqual(["ago", "offline"]);
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
  const motion = PRESETS.Motion.slots.find((s) => s.source === "motion");
  expect(motion?.icon?.glyph).toBe("sensors");
  expect(motion?.rules?.map((r) => r.when)).toEqual([
    "truthy(motion)",
    "!truthy(motion)",
  ]);
  expect(motion?.rules?.[1].disabled).toBe(true);
});

it("gives the light its on/off icon rules and the thermometer its battery badge", () => {
  const light = PRESETS.Light.slots.find((s) => s.source === "power");
  expect(light?.icon?.glyph).toBe("lightbulb");
  expect(light?.rules?.map((r) => r.when)).toEqual([
    "truthy(power)",
    "!truthy(power)",
  ]);
  expect(
    PRESETS.Thermometer.slots
      .filter((s) => s.kind === "badge")
      .map((s) => s.source),
  ).toEqual(["ago", "offline", "battery"]);
});

it("carries every preset's icon on the slot its source named (A55)", () => {
  const expected: { type: keyof typeof PRESETS; at: number; glyph: string }[] =
    [
      { type: "Switch", at: 0, glyph: "power_settings_new" },
      { type: "Button", at: 0, glyph: "touch_app" },
      { type: "Light", at: 0, glyph: "lightbulb" },
      { type: "Thermostat", at: 0, glyph: "thermostat" },
      { type: "Thermometer", at: 0, glyph: "device_thermostat" },
      { type: "Blind", at: 0, glyph: "blinds" },
      { type: "Window", at: 0, glyph: "window" },
      { type: "Motion", at: 0, glyph: "sensors" },
      { type: "AC", at: 3, glyph: "ac_unit" },
      { type: "Value", at: 0, glyph: "speed" },
      { type: "Custom", at: 0, glyph: "widgets" },
    ];
  for (const { type, at, glyph } of expected) {
    const slots = PRESETS[type].slots;
    expect(
      slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.icon)
        .map(({ i }) => i),
    ).toEqual([at]);
    expect(slots[at].icon?.glyph).toBe(glyph);
  }
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
  // Control-less: the badges drop (spec §6), the slots and size still resolve.
  expect(r.slots).toEqual(
    PRESETS.Thermostat.slots.filter(
      (s) => s.kind !== "badge" || s.source === "ago",
    ),
  );
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

it("matches a hint's unit exactly, so Wh is not a watt", () => {
  expect(
    pickControl([{ id: "wh", unit: "Wh" }], "power", new Set()),
  ).toBeUndefined();
  expect(pickControl([{ id: "w", unit: "W" }], "power", new Set())?.id).toBe(
    "w",
  );
  expect(
    pickControl([{ id: "c", unit: "°C" }], "temperature", new Set())?.id,
  ).toBe("c");
});

const ctl = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ...over,
});

it("pickSlotControls walks in order and never hands one control to two slots", () => {
  const slots: Slot[] = [{ kind: "value" }, { kind: "value" }];
  const out = pickSlotControls(slots, [ctl("a"), ctl("b")]);
  expect(out.map((r) => r.control?.id)).toEqual(["a", "b"]);
});

// A38: a frame shows a web page, it reads no control — it must not claim the
// next free one, or a bare value below it would slide to the second control.
it("a frame slot neither claims nor consumes a control (A38)", () => {
  const slots: Slot[] = [
    { kind: "value" },
    { kind: "frame", options: { url: "http://x/echarts/index.html" } },
    { kind: "value" },
  ];
  const out = pickSlotControls(slots, [ctl("a"), ctl("b")]);
  expect(out.map((r) => r.control?.id)).toEqual(["a", undefined, "b"]);
  expect(out[1].dormant).toBeFalsy();
});

it("a failing hint goes dormant and does not claim a control", () => {
  const slots: Slot[] = [
    { kind: "value", options: { pick: "humidity" } },
    { kind: "value" },
  ];
  const out = pickSlotControls(slots, [ctl("a", { unit: "°C" })]);
  expect(out[0]).toMatchObject({ dormant: true });
  expect(out[0].control).toBeUndefined();
  expect(out[1].control?.id).toBe("a"); // positional slot still gets the first control
});

it("a readout's own source still claims the control for a later bare readout", () => {
  const out = pickSlotControls(
    [{ kind: "value", source: "a" }, { kind: "value" }],
    [ctl("a"), ctl("b")],
  );
  expect(out.map((r) => r.control?.id)).toEqual(["a", "b"]);
});

it("names a control by its feature only while that name is unambiguous (A36)", () => {
  const unique = [
    { id: "a", feature: "temperature" },
    { id: "b", feature: "humidity" },
  ];
  expect(sourceForControl(unique, unique[0])).toBe("temperature");
  const shared = [
    { id: "a", feature: "temperature" },
    { id: "b", feature: "temperature" },
  ];
  expect(sourceForControl(shared, shared[1])).toBe("b");
  const bare = [{ id: "c" }];
  expect(sourceForControl(bare, bare[0])).toBe("c");
});

it("a free-text hint matches role, label or unit", () => {
  const slots: Slot[] = [
    { kind: "value", options: { pick: "Luftfeuchtigkeit" } },
  ];
  const out = pickSlotControls(slots, [
    ctl("h", { label: "Luftfeuchtigkeit", unit: "%" }),
  ]);
  expect(out[0].control?.id).toBe("h");
});

it("state-hidden slots drop out before the positional walk", () => {
  const slots: Slot[] = [
    { kind: "value", showWhen: "active" },
    { kind: "value" },
  ];
  const out = pickSlotControls(slots, [ctl("a")], { active: false });
  expect(out.length).toBe(1);
  expect(out[0].control?.id).toBe("a"); // not consumed by the hidden slot
});

it("a raw source resolves through the raw callback", () => {
  const raw = (source: string) =>
    source === "0_userdata.0.x" ? ctl("raw", { stateId: source }) : undefined;
  const out = pickSlotControls(
    [{ kind: "value", source: "0_userdata.0.x" }],
    [],
    {
      raw,
    },
  );
  expect(out[0].control?.id).toBe("raw");
  const missing = pickSlotControls([{ kind: "value", source: "nope" }], [], {
    raw,
  });
  expect(missing[0]).toMatchObject({ dormant: true });
});

it("unknown showWhen counts as both", () => {
  expect(
    pickSlotControls(
      [{ kind: "value", showWhen: "garbage" as never }],
      [ctl("a")],
    ).length,
  ).toBe(1);
  expect(slotVisible({ kind: "value" }, false)).toBe(true);
});

// A35: a duplicated slot is legal config — two identical rows render twice and
// each must be deleted on its own. The resolver must never merge them (the
// per-row keying in the display is positional for the same reason).
it("keeps duplicate slots apart instead of merging them", () => {
  const slots: Slot[] = [
    { kind: "value", source: "a" },
    { kind: "value", source: "a" },
  ];
  const out = pickSlotControls(slots, [ctl("a")], {});
  expect(out.length).toBe(2);
  expect(out[0].slot).not.toBe(out[1].slot);
});
