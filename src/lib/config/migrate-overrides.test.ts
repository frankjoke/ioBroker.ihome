import { describe, expect, it } from "vitest";
import { migrateDevices } from "./migrate-overrides";
import { evaluateOverride, overrideGroup } from "./source-overrides";
import { resolveTile } from "./tile-resolve";
import {
  hasHistory,
  rowSpark,
  tileParts,
  tileSourceControls,
} from "./tile-parts";
import { resolveBadges } from "./rule-ops";
import type { Control, Device } from "$lib/types/device";
import type {
  PageRegistry,
  Placement,
  Slot,
  Template,
  TemplateRegistry,
} from "$lib/types/display";
import type { GlobalVariable } from "./variables";

const emptyTemplates = (): TemplateRegistry => ({
  version: 1,
  updatedAt: 1,
  templates: [],
});

const pages = (...tiles: Placement[]): PageRegistry => ({
  version: 2,
  updatedAt: 1,
  pages: [{ id: "p", title: "P", groups: [{ id: "g", title: "G", tiles }] }],
});

const placement = (
  slots: Slot[],
  tile: Record<string, unknown> = {},
): Placement => ({ id: "t", tile: { slots, ...tile } });

const device = (over: Partial<Device> = {}): Device => ({
  id: "light",
  name: "Flur.Light",
  type: "Light",
  controls: [],
  ...over,
});

const control = (over: Partial<Control> = {}): Control => ({
  id: "c1",
  feature: "power",
  stateId: "hm.0.light.power",
  writable: true,
  ...over,
});

const sourceSlot = (): Slot => ({
  kind: "switch",
  source: { kind: "control", device: "light", control: "c1" },
});

/** One channel with its state objects, so `$.` names resolve like the app. */
const out = (ids: string[], names: Record<string, string> = {}) => {
  const map = new Map<string, any>();
  map.set("hm.0.light", { _id: "hm.0.light", type: "channel" });
  map.set("hm.0.sensor", { _id: "hm.0.sensor", type: "channel" });
  for (const id of ids) {
    map.set(id, {
      _id: id,
      type: "state",
      common: { name: names[id] ?? "", type: "number" },
    });
  }
  return map;
};

describe("migrateDevices — repairs", () => {
  it("turns a control into a repair override and points its slot at it", () => {
    const power = control({
      label: "Power",
      unit: "W",
      role: "switch.light",
      type: "boolean",
      read: true,
      write: true,
      transform: {
        read: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
      },
      history: { duration: 1, durationUnit: "days" },
    });
    const res = migrateDevices({
      devices: [device({ controls: [power] })],
      pages: pages(
        placement([
          {
            kind: "switch",
            source: { kind: "control", device: "light", control: "c1" },
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
      now: 10,
    });

    expect(res.overrides.overrides).toHaveLength(1);
    const o = res.overrides.overrides[0];
    expect(o).toMatchObject({
      id: "mig-light-c1",
      stateId: "hm.0.light.power",
      kind: "repair",
      name: "power",
      label: "Power",
      unit: "W",
      role: "switch.light",
      type: "boolean",
      read: true,
      write: true,
      transform: {
        read: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
      },
      history: { duration: 1, durationUnit: "days" },
    });
    const slot = res.pages.pages[0].groups[0].tiles![0].tile!.slots![0];
    expect(slot.source).toEqual({
      kind: "state",
      stateId: "hm.0.light.power",
      override: o.id,
    });
    expect(res.changed).toBe(true);
  });

  it("keeps the chart feed: a migrated sparkline row reports history", () => {
    const power = control({ history: { duration: 2, durationUnit: "hours" } });
    const migrated = migrateDevices({
      devices: [device({ controls: [power] })],
      pages: pages(
        placement([
          {
            kind: "value",
            source: { kind: "control", device: "light", control: "c1" },
            spark: {},
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const tile = migrated.pages.pages[0].groups[0].tiles![0].tile!;
    const states = new Map<string, any>([["hm.0.light.power", { val: 1 }]]);
    const objects = out(["hm.0.light.power"]);
    const resolution = resolveTile(tile, "Flur", {
      devices: [],
      states,
      objects,
      overrides: migrated.overrides.overrides,
    });
    const parts = tileParts(resolution.device, resolution.tile, [], {
      devices: [],
      states,
      objects,
      overrides: migrated.overrides.overrides,
    });
    expect(hasHistory(parts.rows[0].control)).toBe(true);
    expect(rowSpark(parts.rows, parts.rows[0], "tile")).toBeDefined();
  });

  it("creates one override per control on the same state, labels intact", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [
            control({ id: "c1", feature: "power", label: "Power" }),
            control({ id: "c2", feature: "brightness", label: "Helligkeit" }),
          ],
        }),
      ],
      pages: pages(
        placement([
          {
            kind: "switch",
            label: "Power",
            source: { kind: "control", device: "light", control: "c1" },
          },
          {
            kind: "level",
            label: "Helligkeit",
            source: { kind: "control", device: "light", control: "c2" },
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    expect(res.overrides.overrides.map((o) => o.name)).toEqual([
      "power",
      "brightness",
    ]);
    expect(new Set(res.overrides.overrides.map((o) => o.stateId))).toEqual(
      new Set(["hm.0.light.power"]),
    );
    const slots = res.pages.pages[0].groups[0].tiles![0].tile!.slots!;
    expect(slots.map((slot) => (slot.source as any).override)).toEqual([
      "mig-light-c1",
      "mig-light-c2",
    ]);
    expect(slots.map((slot) => slot.label)).toEqual(["Power", "Helligkeit"]);
  });

  it("suffixes a repeated feature name in control order", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [
            control({ id: "c1", feature: "power" }),
            control({ id: "c2", feature: "power" }),
          ],
        }),
      ],
      pages: pages(placement([])),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    expect(res.overrides.overrides.map((o) => o.name)).toEqual([
      "power",
      "power2",
    ]);
  });

  it("copies the legacy common block when the control has no explicit field", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [
            control({
              id: "c9",
              feature: "energy",
              label: "Energy",
              common: {
                name: "Zähler",
                unit: "kWh",
                role: "value.energy",
                type: "number",
                min: 0,
                max: 1000,
                read: true,
              },
            }),
          ],
        }),
      ],
      pages: pages(placement([])),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    expect(res.overrides.overrides[0]).toMatchObject({
      name: "energy",
      label: "Energy",
      unit: "kWh",
      role: "value.energy",
      type: "number",
      min: 0,
      max: 1000,
      read: true,
    });
  });

  it("appends a control's own default rules to the slots that bind it", () => {
    const power = control({
      rules: [{ when: "!truthy(power)", color: "red" }],
    });
    const res = migrateDevices({
      devices: [device({ controls: [power] })],
      pages: pages(
        placement([
          {
            kind: "switch",
            rules: [{ when: "truthy(power)", color: "green" }],
            source: { kind: "control", device: "light", control: "c1" },
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const rules =
      res.pages.pages[0].groups[0].tiles![0].tile!.slots![0].rules ?? [];
    expect(rules.map((rule) => rule.when)).toEqual([
      "truthy(power)",
      "!truthy(power)",
    ]);
  });
});

describe("migrateDevices — virtual controls", () => {
  const sensor = () =>
    device({
      id: "sensor",
      name: "Bad.Sensor",
      type: "Thermometer",
      controls: [
        control({
          id: "t",
          feature: "temperature",
          stateId: "hm.0.sensor.temperature",
          writable: false,
        }),
        control({
          id: "h",
          feature: "humidity",
          stateId: "hm.0.sensor.humidity",
          writable: false,
        }),
        control({
          id: "d",
          feature: "dewpoint",
          kind: "virtual",
          stateId: undefined,
          writable: false,
          label: "Dew",
          virtual: { expr: "temperature - humidity * 0.1", precision: 1 },
        }),
      ],
    });

  it("becomes a derived override with $. inputs in expression order", () => {
    const res = migrateDevices({
      devices: [sensor()],
      pages: pages(
        placement([
          {
            kind: "value",
            source: { kind: "control", device: "sensor", control: "d" },
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.sensor.temperature", "hm.0.sensor.humidity"]),
    });
    const derived = res.overrides.overrides.find((o) => o.kind === "derived")!;
    expect(derived).toMatchObject({
      stateId: "hm.0.sensor.temperature",
      name: "dewpoint",
      label: "Dew",
      precision: 1,
      expr: "$.temperature - $.humidity * 0.1",
      inputs: ["hm.0.sensor.temperature", "hm.0.sensor.humidity"],
    });
    const slot = res.pages.pages[0].groups[0].tiles![0].tile!.slots![0];
    expect(slot.source).toEqual({
      kind: "state",
      stateId: "hm.0.sensor.temperature",
      override: derived.id,
    });
  });

  it("rewrites a $. name that would read another state to get()", () => {
    // Both inputs carry the feature "value", so both repairs are called
    // "value"; the group can only give the anchor's state that name.
    const b = device({
      id: "b",
      name: "B",
      type: "Thermometer",
      controls: [
        control({
          id: "ca",
          feature: "value",
          label: "A",
          stateId: "hm.0.sensor.a",
          writable: false,
        }),
        control({
          id: "cb",
          feature: "value",
          label: "B",
          stateId: "hm.0.sensor.b",
          writable: false,
        }),
        control({
          id: "sum",
          feature: "sum",
          kind: "virtual",
          writable: false,
          virtual: { expr: "a + b" },
        }),
      ],
    });
    const res = migrateDevices({
      devices: [b],
      pages: pages(
        placement([
          {
            kind: "value",
            source: { kind: "control", device: "b", control: "sum" },
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.sensor.a", "hm.0.sensor.b"]),
    });
    const derived = res.overrides.overrides.find((o) => o.kind === "derived")!;
    expect(derived.stateId).toBe("hm.0.sensor.a");
    expect(derived.expr).toBe('$.value + get("hm.0.sensor.b")');
    expect(res.log.join("\n")).toMatch(
      /\$\.value would read "hm\.0\.sensor\.a".*using get\("hm\.0\.sensor\.b"\)/,
    );
  });

  it("uses get() for an input outside the anchor group and logs it", () => {
    const d = device({
      id: "d",
      name: "D",
      type: "Thermometer",
      controls: [
        control({
          id: "t",
          feature: "temperature",
          stateId: "hm.0.sensor.temperature",
          writable: false,
        }),
        control({
          id: "o",
          feature: "outside",
          label: "Outside",
          stateId: "other.0.sensor.temperature",
          writable: false,
        }),
        control({
          id: "avg",
          feature: "average",
          kind: "virtual",
          writable: false,
          virtual: { expr: "temperature + outside" },
        }),
      ],
    });
    const res = migrateDevices({
      devices: [d],
      pages: pages(placement([])),
      templates: emptyTemplates(),
      objects: out(["hm.0.sensor.temperature", "other.0.sensor.temperature"]),
    });
    const derived = res.overrides.overrides.find((o) => o.kind === "derived")!;
    expect(derived.expr).toBe(
      '$.temperature + get("other.0.sensor.temperature")',
    );
    expect(derived.inputs).toEqual([
      "hm.0.sensor.temperature",
      "other.0.sensor.temperature",
    ]);
    expect(res.log.join("\n")).toMatch(
      /using get\("other\.0\.sensor\.temperature"\)/,
    );
  });

  it("skips a virtual with no state input and reports it", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [
            control({
              id: "v",
              feature: "answer",
              kind: "virtual",
              writable: false,
              virtual: { expr: "40 + 2" },
            }),
          ],
        }),
      ],
      pages: pages(placement([])),
      templates: emptyTemplates(),
      objects: out([]),
    });
    expect(res.overrides.overrides).toEqual([]);
    expect(res.log.join("\n")).toMatch(/skipped virtual "light\/answer"/);
  });
});

describe("migrateDevices — rules and tiles", () => {
  it("adds a watch override for a rule naming an unbound control", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [
            control({ id: "c1", feature: "power" }),
            control({
              id: "c2",
              feature: "battery",
              stateId: "hm.0.light.battery",
              writable: false,
            }),
          ],
        }),
      ],
      pages: pages(
        placement([
          {
            kind: "switch",
            source: { kind: "control", device: "light", control: "c1" },
            rules: [{ when: "battery < 20", hidden: true }],
          },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power", "hm.0.light.battery"]),
    });
    const tile = res.pages.pages[0].groups[0].tiles![0].tile!;
    expect(tile.watchOverrides).toEqual(["mig-light-c2"]);
    const controls = tileSourceControls(tile.slots ?? [], {
      overrides: res.overrides.overrides,
      states: new Map(),
      objects: out(["hm.0.light.power", "hm.0.light.battery"]),
      watchOverrides: tile.watchOverrides,
    });
    expect(controls.map((entry) => entry.feature)).toEqual([
      "power",
      "battery",
    ]);
  });

  it("binds a device-wide ago/offline badge to the headline source", () => {
    const res = migrateDevices({
      devices: [
        device({
          controls: [control({ id: "c1", feature: "power" })],
        }),
      ],
      pages: pages(
        placement([
          {
            kind: "switch",
            source: { kind: "control", device: "light", control: "c1" },
          },
          {
            kind: "badge",
            source: { kind: "device", device: "light" },
            options: { derive: "ago" },
          },
          { kind: "badge", source: { kind: "device", device: "light" } },
          { kind: "badge", source: "ago" },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const slots = res.pages.pages[0].groups[0].tiles![0].tile!.slots!;
    expect(slots[1]).toMatchObject({
      source: "ago",
      options: { of: "hm.0.light.power" },
    });
    expect(slots[2]).toMatchObject({
      source: "offline",
      options: { of: "hm.0.light.power" },
    });
    expect(slots[3]).toMatchObject({
      source: "ago",
      options: { of: "hm.0.light.power" },
    });
  });

  it("the migrated ago and offline badges still resolve at render", () => {
    const res = migrateDevices({
      devices: [
        device({ controls: [control({ id: "c1", feature: "power" })] }),
      ],
      pages: pages(
        placement([
          {
            kind: "switch",
            source: { kind: "control", device: "light", control: "c1" },
          },
          {
            kind: "badge",
            source: { kind: "device", device: "light" },
            options: { derive: "ago" },
          },
          { kind: "badge", source: { kind: "device", device: "light" } },
        ]),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const tile = res.pages.pages[0].groups[0].tiles![0].tile!;
    const online = new Map<string, any>([
      ["hm.0.light.power", { val: 1, ts: 9_000 }],
    ]);
    const live = resolveTile(tile, "Flur", {
      devices: [],
      states: online,
      objects: out(["hm.0.light.power"]),
      overrides: res.overrides.overrides,
    });
    const ago = resolveBadges(
      [live.tile.slots![1]],
      live.device,
      9_000,
      10_000,
    );
    expect(ago[0]?.source).toBe("ago");

    const missing = resolveTile(tile, "Flur", {
      devices: [],
      states: new Map(),
      objects: new Map(),
      overrides: res.overrides.overrides,
    });
    const offline = resolveBadges(
      [missing.tile.slots![2]],
      missing.device,
      0,
      10_000,
    );
    expect(offline[0]?.source).toBe("offline");
  });

  it("copies the device title and icon only where the tile has none", () => {
    const res = migrateDevices({
      devices: [
        device({
          title: "Flur",
          icon: "lightbulb",
          controls: [control({ id: "c1", feature: "power" })],
        }),
      ],
      pages: pages(
        { id: "a", tile: { slots: [sourceSlot()] } },
        {
          id: "b",
          title: "Own",
          tile: { slots: [sourceSlot()], icon: "star" },
        },
        { id: "c", title: "", tile: { slots: [sourceSlot()], icon: "" } },
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const [a, b, c] = res.pages.pages[0].groups[0].tiles!;
    expect(a.title).toBe("Flur");
    expect(a.tile!.icon).toBe("lightbulb");
    expect(a.tile!.iconAuto).toBe(true);
    expect(b.title).toBe("Own");
    expect(b.tile!.icon).toBe("star");
    expect(c.title).toBe("");
    expect(c.tile!.icon).toBe("");
  });

  it("converts a tile's active control and device sources", () => {
    const res = migrateDevices({
      devices: [
        device({ controls: [control({ id: "c1", feature: "power" })] }),
      ],
      pages: pages(
        placement([], {
          active: {
            source: { kind: "control", device: "light", control: "c1" },
            op: "truthy",
          },
        }),
        placement([], {
          active: {
            source: { kind: "device", device: "light" },
            op: "truthy",
          },
        }),
      ),
      templates: emptyTemplates(),
      objects: out(["hm.0.light.power"]),
    });
    const expected = {
      kind: "state",
      stateId: "hm.0.light.power",
      override: "mig-light-c1",
    };
    expect(res.pages.pages[0].groups[0].tiles![0].tile!.active!.source).toEqual(
      expected,
    );
    expect(res.pages.pages[0].groups[0].tiles![1].tile!.active!.source).toEqual(
      expected,
    );
  });
});

describe("migrateDevices — templates", () => {
  it("turns a device template into a role template", () => {
    const template: Template = {
      id: "tpl",
      name: "Tpl",
      type: "Light",
      features: [
        {
          feature: "power",
          label: "Power",
          widget: "switch",
          roleHints: ["switch.light"],
        },
        {
          feature: "brightness",
          label: "Brightness",
          widget: "level",
          roleHints: ["level.dimmer"],
        },
      ],
      slots: [
        {
          kind: "switch",
          source: "power",
          rules: [{ when: "truthy(power)", color: "green" }],
        },
        { kind: "level", source: "brightness" },
        { kind: "badge", source: "ago", options: { of: "power" } },
        { kind: "badge", options: { pick: "brightness" } },
      ],
      active: { source: "power", op: "truthy" },
    };
    const res = migrateDevices({
      devices: [],
      pages: pages(),
      templates: { version: 1, updatedAt: 1, templates: [template] },
      now: 20,
    });
    const migrated = res.templates.templates[0];
    expect(migrated.roles).toEqual(["power", "brightness"]);
    expect(migrated.features).toEqual([]);
    expect(migrated.type).toBe("Light");
    expect(migrated.slots[0]).toMatchObject({
      source: "power",
      rules: [{ when: "truthy(power)", color: "green" }],
      repair: {
        kind: "repair",
        name: "power",
        label: "Power",
        role: "switch.light",
      },
    });
    expect(migrated.slots[1].source).toBe("brightness");
    expect(migrated.slots[1].repair).toMatchObject({
      name: "brightness",
      label: "Brightness",
      role: "level.dimmer",
    });
    expect(migrated.slots[2].options).toMatchObject({ of: "power" });
    expect(migrated.slots[3].source).toBe("brightness");
    expect(migrated.slots[3].options).toBeUndefined();
    expect(migrated.slots[3].repair).toMatchObject({
      name: "brightness",
      role: "level.dimmer",
    });
    expect(migrated.active!.source).toBe("power");
    expect(res.templates.updatedAt).toBe(20);
  });
});

describe("migrateDevices — idempotency", () => {
  it("running twice changes nothing", () => {
    const input = {
      devices: [
        device({ controls: [control({ id: "c1", feature: "power" })] }),
      ],
      pages: pages(
        placement([
          {
            kind: "switch",
            source: { kind: "control", device: "light", control: "c1" },
          },
        ]),
      ),
      templates: {
        version: 1,
        updatedAt: 1,
        templates: [
          {
            id: "tpl",
            name: "Tpl",
            type: "Light",
            features: [
              {
                feature: "power",
                label: "Power",
                widget: "switch",
                roleHints: ["switch.light"],
              },
            ],
            slots: [{ kind: "switch", source: "power" }],
          } satisfies Template,
        ],
      },
      objects: out(["hm.0.light.power"]),
    };
    const first = migrateDevices(input);
    expect(first.changed).toBe(true);
    const second = migrateDevices({
      ...input,
      overrides: first.overrides,
      pages: first.pages,
      templates: first.templates,
    });
    expect(second.changed).toBe(false);
    expect(second.overrides.overrides).toEqual(first.overrides.overrides);
    expect(second.pages).toBe(first.pages);
    expect(second.templates).toBe(first.templates);
    expect(second.log).toEqual([]);
  });
});

describe("migrateDevices — derived evaluation", () => {
  it("evaluates the migrated derived override through its group", () => {
    const res = migrateDevices({
      devices: [
        device({
          id: "sensor",
          name: "Sensor",
          type: "Thermometer",
          controls: [
            control({
              id: "t",
              feature: "temperature",
              stateId: "hm.0.sensor.temperature",
              writable: false,
            }),
            control({
              id: "h",
              feature: "humidity",
              stateId: "hm.0.sensor.humidity",
              writable: false,
            }),
            control({
              id: "d",
              feature: "dewpoint",
              kind: "virtual",
              writable: false,
              virtual: { expr: "temperature - humidity * 0.1" },
            }),
          ],
        }),
      ],
      pages: pages(placement([])),
      templates: emptyTemplates(),
      objects: out(["hm.0.sensor.temperature", "hm.0.sensor.humidity"]),
    });
    const derived = res.overrides.overrides.find((o) => o.kind === "derived")!;
    const objects = out(["hm.0.sensor.temperature", "hm.0.sensor.humidity"]);
    const states = new Map<string, any>([
      ["hm.0.sensor.temperature", { val: 20 }],
      ["hm.0.sensor.humidity", { val: 50 }],
    ]);
    const group = overrideGroup(
      derived.stateId,
      objects,
      res.overrides,
      [] as GlobalVariable[],
    );
    const result = evaluateOverride(derived, {
      group,
      states,
      registry: res.overrides,
      objects,
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(15);
    expect(result.inputs).toEqual([
      "hm.0.sensor.temperature",
      "hm.0.sensor.humidity",
    ]);
  });
});
