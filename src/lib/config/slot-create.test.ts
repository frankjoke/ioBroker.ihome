import { it, expect } from "vitest";
import {
  applyTileSeed,
  autoFillRoles,
  boundFills,
  materializeTemplateTileFromFills,
  materializeTemplateTileFromState,
  materializedTileConfig,
  originFills,
  slotFromControl,
  slotFromState,
  slotKindForWidget,
  templateBindingRows,
  templateTileSeed,
} from "$lib/config/slot-create";
import { PRESETS } from "$lib/config/presets";
import { labelShown } from "$lib/config/tile-parts";
import type { Control, Device } from "$lib/types/device";
import type { Template, TileConfig } from "$lib/types/display";

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

/** The alias fixture the template materialisation tests share. */
const lampFixture = () => {
  const main = {
    ref: "alias.0.Lamp.SET",
    stateId: "alias.0.Lamp.SET",
    object: {
      type: "state",
      common: { name: "Lamp", role: "switch.light", type: "boolean" },
    },
  };
  const objects = new Map<string, any>([
    ["alias.0.Lamp", { type: "channel", common: { name: "Lamp" } }],
    ["alias.0.Lamp.SET", main.object],
    [
      "alias.0.Lamp.brightness",
      {
        type: "state",
        common: {
          name: "Brightness",
          role: "level.dimmer",
          type: "number",
          min: 0,
          max: 100,
        },
      },
    ],
    [
      "alias.0.Lamp.colortemp",
      {
        type: "state",
        common: {
          name: "Color temperature",
          role: "level.color.temperature",
          type: "number",
        },
      },
    ],
    [
      "alias.0.Lamp.available",
      {
        type: "state",
        common: {
          name: "Available",
          role: "indicator.reachable",
          type: "boolean",
        },
      },
    ],
  ]);
  return { main, objects };
};

it("carries the bare-face options into the tile", () => {
  expect(
    materializedTileConfig({ slots: [], border: false, padding: false }),
  ).toMatchObject({ slots: [], border: false, padding: false });
});

it("takes the face icon from the template's default look, else the seed", () => {
  expect(
    materializedTileConfig({
      slots: [],
      icon: "seed",
      look: {
        inactive: { glyph: "template_default" },
        active: { glyph: "template_on" },
      },
    }).icon,
  ).toBe("template_default");
  expect(materializedTileConfig({ slots: [], icon: "seed" }).icon).toBe("seed");
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

it("binds a raw-state slot to an override", () => {
  expect(
    slotFromState("x.0.a", { common: { name: "A" } }, "value", "o1").source,
  ).toEqual({ kind: "state", stateId: "x.0.a", override: "o1" });
});

it("maps widgets to their slot kind", () => {
  expect(slotKindForWidget("switch")).toBe("switch");
  expect(slotKindForWidget("level")).toBe("level");
  expect(slotKindForWidget("color")).toBe("color");
  expect(slotKindForWidget("enum")).toBe("enum");
  expect(slotKindForWidget("button")).toBe("button");
  expect(slotKindForWidget("value")).toBe("value");
});

it("fills active, look and background from the seed without overwriting", () => {
  const seed = {
    active: { source: "power", op: "truthy" as const },
    look: { active: { glow: "red" } },
    size: { w: 2 as const, h: 2 as const },
    background: { kind: "solid" as const, value: "#000" },
  };
  expect(applyTileSeed({ slots: [] }, seed)).toMatchObject({
    active: seed.active,
    look: seed.look,
    size: seed.size,
    background: seed.background,
  });
  expect(
    applyTileSeed(
      {
        slots: [],
        active: { source: "x", op: "truthy" },
        look: { inactive: { glyph: "x" } },
      },
      seed,
    ).active,
  ).toEqual({ source: "x", op: "truthy" });
  expect(
    applyTileSeed(
      { slots: [], look: { inactive: { glyph: "x" } } },
      { look: { inactive: { color: "red" } } },
    ).look?.inactive,
  ).toEqual({ color: "red", glyph: "x" });
});

it("builds a Light tile from a state without creating a device", () => {
  const { main, objects } = lampFixture();
  const result = materializeTemplateTileFromState(
    PRESETS.Light,
    main,
    objects,
    "power",
  );
  // The same slots the device tile has: power, dimmer, colour temperature,
  // ago and availability ago; colour and battery have no state here.
  expect(result.slots.map((slot) => slot.kind)).toEqual([
    "switch",
    "level",
    "level",
    "badge",
    "badge",
  ]);
  expect(result.slots[0].source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.SET",
  });
  expect(result.slots[2].source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.colortemp",
  });
  // The same captions the device tile gets from its feature controls.
  expect(result.slots.map((slot) => slot.label)).toEqual([
    "Power",
    "Brightness",
    "Color Temp",
    undefined,
    "Connected",
  ]);
  const ago = result.slots.find((slot) => slot.source === "ago");
  expect(ago?.options).toMatchObject({
    of: "alias.0.Lamp.SET",
    from: "lc",
  });
  const offline = result.slots.find((slot) => slot.options?.derive === "ago");
  expect(offline?.source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.available",
  });
  expect(offline?.rules).toEqual([
    { when: "!isOnline(connected)", only: true, tone: "danger" },
  ]);
  expect(result.title).toBe("Lamp");
  expect(result.active).toMatchObject({
    source: { kind: "state", stateId: "alias.0.Lamp.SET" },
    op: "truthy",
  });
});

it("binds only filled features and drops the rest", () => {
  const { main, objects } = lampFixture();
  const fills = new Map([
    ["power", main],
    [
      "brightness",
      {
        ref: "alias.0.Lamp.brightness",
        stateId: "alias.0.Lamp.brightness",
        object: objects.get("alias.0.Lamp.brightness"),
      },
    ],
  ]);
  const result = materializeTemplateTileFromFills(PRESETS.Light, fills, main);
  expect(result.slots.map((slot) => slot.kind)).toEqual([
    "switch",
    "level",
    "badge",
  ]);
  const ago = result.slots.find((slot) => slot.source === "ago");
  expect(ago?.options?.of).toBe("alias.0.Lamp.SET");
  expect(result.active?.source).toEqual({
    kind: "state",
    stateId: "alias.0.Lamp.SET",
  });
  expect(result.title).toBe("Lamp");
});

it("keeps active only when its feature is bound", () => {
  const { main, objects } = lampFixture();
  const fills = new Map([
    [
      "brightness",
      {
        ref: "alias.0.Lamp.brightness",
        stateId: "alias.0.Lamp.brightness",
        object: objects.get("alias.0.Lamp.brightness"),
      },
    ],
  ]);
  const result = materializeTemplateTileFromFills(PRESETS.Light, fills, main);
  expect(result.active).toBeUndefined();
});

it("lists only the features the template binds, plus the primary", () => {
  const t = {
    ...PRESETS.Light,
    features: [
      ...PRESETS.Light.features,
      { feature: "unused", label: "Unused", widget: "value", roleHints: [] },
    ],
  } as Template;
  expect(templateBindingRows(t).map((f) => f.key)).not.toContain("unused");
  expect(templateBindingRows(t).map((f) => f.key)).toContain("power");
  const raw = {
    ...PRESETS.Light,
    active: undefined,
    slots: [{ kind: "value", source: { kind: "state", stateId: "x" } }],
  } as unknown as Template;
  expect(templateBindingRows(raw).map((f) => f.key)).toEqual(
    PRESETS.Light.features.map((f) => f.feature),
  );
});

it("returns no bindings for an anchorless HTML template", () => {
  const t = {
    id: "html-only",
    name: "HTML only",
    type: "Custom",
    bindings: "none",
    features: [],
    slots: [{ kind: "html", options: { html: "<p>x</p>" } }],
  } as unknown as Template;
  expect(templateBindingRows(t)).toEqual([]);
});

it("seeds a new tile from the template defaults", () => {
  const template = {
    id: "html-only",
    name: "HTML only",
    type: "Custom",
    bindings: "none",
    size: { w: 3, h: 2 },
    border: false,
    padding: false,
    features: [],
    slots: [{ kind: "html", label: "Body" }],
  } as unknown as Template;
  const seed = templateTileSeed(template);
  expect(seed.title).toBe("HTML only");
  expect(applyTileSeed({} as TileConfig, seed)).toMatchObject({
    size: { w: 3, h: 2 },
    border: false,
    padding: false,
    template: "html-only",
  });
});

it("takes unambiguous auto-fills and lets manual choices win", () => {
  const { main } = lampFixture();
  const power = PRESETS.Light.features.find((f) => f.feature === "power")!;
  const brightness = PRESETS.Light.features.find(
    (f) => f.feature === "brightness",
  )!;
  const fills = [
    {
      feature: power,
      ref: main.ref,
      stateId: main.stateId,
      object: main.object,
      candidates: [main],
      ambiguous: false,
    },
    { feature: brightness, candidates: [], ambiguous: true },
  ];
  expect([...boundFills(fills).keys()]).toEqual(["power"]);
  const manual = new Map([
    ["brightness", { ref: "x", stateId: "x", object: {} }],
  ]);
  expect([...boundFills(fills, manual).keys()]).toEqual([
    "power",
    "brightness",
  ]);
});

it("ignores slot sources that are not catalog features", () => {
  const t = {
    ...PRESETS.Light,
    active: undefined,
    slots: [
      { kind: "value", source: "ago" },
      { kind: "value", source: "hue.0.raw" },
    ],
  } as unknown as Template;
  expect(templateBindingRows(t).map((f) => f.key)).toEqual(
    PRESETS.Light.features.map((f) => f.feature),
  );
});

it("keeps a raw frame slot when materialising from fills", () => {
  const t = {
    ...PRESETS.Light,
    slots: [{ kind: "frame", options: { url: "https://example.test" } }],
  } as unknown as Template;
  const { main } = lampFixture();
  const result = materializeTemplateTileFromFills(t, new Map(), main);
  expect(result.slots).toHaveLength(1);
  expect(result.slots[0].kind).toBe("frame");
});

it("offers the active feature as a row even without a slot", () => {
  const t = {
    ...PRESETS.Light,
    features: [
      ...PRESETS.Light.features,
      {
        feature: "extra",
        label: "Extra",
        widget: "value",
        roleHints: [],
      },
    ],
    active: { source: "extra", op: "truthy" },
  } as unknown as Template;
  expect(templateBindingRows(t).map((f) => f.key)).toContain("extra");
});

it("lists role rows for a role template, the active role first", () => {
  const t = {
    id: "r",
    name: "Roles",
    type: "Custom",
    roles: ["temperature", "humidity", "switch"],
    features: [],
    active: { source: "switch", op: "truthy" },
    slots: [
      {
        kind: "value",
        source: "temperature",
        label: "Temperature",
        repair: {
          kind: "repair",
          name: "temperature",
          label: "Temperature",
          unit: "°C",
          role: "temperature",
        },
      },
      { kind: "value", source: "humidity", label: "Humidity" },
      {
        kind: "switch",
        source: "switch",
        repair: { kind: "repair", name: "switch", role: "switch" },
      },
    ],
  } as Template;
  const rows = templateBindingRows(t);
  expect(rows.map((row) => row.key)).toEqual([
    "temperature",
    "humidity",
    "switch",
  ]);
  expect(rows[0].label).toBe("Temperature");
  expect(rows[0].unit).toBe("°C");
  expect(rows.find((row) => row.primary)?.key).toBe("switch");
});

it("auto-fills sibling roles by role, then unit, then name", () => {
  const main = {
    ref: "home.climate.main",
    stateId: "home.climate.main",
    object: {
      type: "state",
      common: { name: "Climate", role: "temperature", type: "number" },
    },
  };
  const objects = new Map<string, any>([
    ["home.climate", { type: "channel", common: { name: "Home" } }],
    ["home.climate.main", main.object],
    [
      "home.climate.humidity",
      {
        type: "state",
        common: { name: "Humidity", role: "humidity", type: "number" },
      },
    ],
    [
      "home.climate.second",
      {
        type: "state",
        common: {
          name: "Outdoor temperature",
          role: "temperature",
          type: "number",
        },
      },
    ],
    [
      "home.climate.unit",
      {
        type: "state",
        common: {
          name: "Humidity sensor",
          role: "value",
          type: "number",
          unit: "%",
        },
      },
    ],
    [
      "home.climate.switch",
      {
        type: "state",
        common: { name: "Lamp", role: "switch", type: "boolean" },
      },
    ],
  ]);
  const t = {
    id: "r2",
    name: "Roles",
    type: "Custom",
    roles: ["temperature", "humidity", "switch"],
    features: [],
    active: { source: "temperature", op: "truthy" },
    slots: [
      {
        kind: "value",
        source: "temperature",
        repair: {
          kind: "repair",
          name: "temperature",
          role: "temperature",
          unit: "°C",
        },
      },
      {
        kind: "value",
        source: "humidity",
        repair: {
          kind: "repair",
          name: "humidity",
          role: "humidity",
          unit: "%",
        },
      },
      {
        kind: "switch",
        source: "switch",
        repair: { kind: "repair", name: "switch", role: "switch" },
      },
    ],
  } as Template;
  const overrides = [
    {
      id: "ov-hum",
      stateId: "home.climate.humidity",
      kind: "repair" as const,
      name: "Humidity %",
      role: "humidity",
    },
  ];
  const fills = autoFillRoles(t, main, objects, "temperature", overrides);
  // The anchor keeps the picked state.
  expect(fills.get("temperature")?.stateId).toBe("home.climate.main");
  // The role match wins over the unit/name match on the other state.
  expect(fills.get("humidity")?.stateId).toBe("home.climate.humidity");
  expect(fills.get("humidity")?.overrideId).toBe("ov-hum");
  expect(fills.get("switch")?.stateId).toBe("home.climate.switch");
  // A second role with the same role name is ambiguous and is not stolen.
  expect(fills.get("temperature")?.stateId).not.toBe("home.climate.second");
});

it("prefers an exact role over a generic family match", () => {
  const main = {
    ref: "home.climate.main",
    stateId: "home.climate.main",
    object: {
      type: "state",
      common: { name: "Lamp", role: "switch", type: "boolean" },
    },
  };
  const objects = new Map<string, any>([
    ["home.climate", { type: "channel", common: { name: "Home" } }],
    ["home.climate.main", main.object],
    [
      "home.climate.power",
      {
        type: "state",
        common: {
          name: "Power",
          role: "value.power",
          type: "number",
          unit: "W",
        },
      },
    ],
    [
      "home.climate.factor",
      {
        type: "state",
        common: { name: "Power factor", role: "value", type: "number" },
      },
    ],
  ]);
  const t = {
    id: "r3",
    name: "Roles",
    type: "Custom",
    roles: ["switch", "value_power"],
    features: [],
    active: { source: "switch", op: "truthy" },
    slots: [
      {
        kind: "switch",
        source: "switch",
        repair: { kind: "repair", name: "switch", role: "switch" },
      },
      {
        kind: "value",
        source: "value_power",
        repair: { kind: "repair", name: "value_power", role: "value.power" },
      },
    ],
  } as Template;
  const fills = autoFillRoles(t, main, objects, "switch", []);
  // `value` is a role family of `value.power`; the exact reading still wins.
  expect(fills.get("value_power")?.stateId).toBe("home.climate.power");
});

it("marks the frozen template icon as automatic", () => {
  const tile = materializedTileConfig({ slots: [], icon: "ac_unit" });
  expect(tile.icon).toBe("ac_unit");
  expect(tile.iconAuto).toBe(true);
});

it("pre-binds roles whose captured origin still exists", () => {
  const template = {
    id: "o1",
    name: "Origins",
    type: "Custom",
    roles: ["level", "level_state"],
    features: [],
    slots: [
      {
        kind: "level",
        source: "level",
        label: "Level",
        origin: "0_userdata.0.lamp.brightness",
        repair: { kind: "repair", name: "level" },
      },
      {
        kind: "level",
        source: "level_state",
        label: "State",
        origin: "0_userdata.0.lamp.missing",
        repair: { kind: "repair", name: "level_state" },
      },
    ],
  } as Template;
  const objects = new Map<string, any>([
    [
      "0_userdata.0.lamp.brightness",
      { type: "state", common: { name: "Brightness", type: "number" } },
    ],
  ]);
  const fills = originFills(template, objects, []);
  expect([...fills.keys()]).toEqual(["level"]);
  expect(fills.get("level")?.stateId).toBe("0_userdata.0.lamp.brightness");
  const tile = materializeTemplateTileFromFills(
    template,
    fills,
    fills.get("level")!,
  );
  // The capture-only hint never reaches the tile.
  expect(tile.slots.every((slot) => slot.origin === undefined)).toBe(true);
});
