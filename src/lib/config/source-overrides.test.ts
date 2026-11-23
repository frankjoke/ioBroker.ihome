import { describe, expect, it } from "vitest";
import type { GlobalVariable } from "./variables";
import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";
import {
  emptyOverrideRegistry,
  ensureRepairOverride,
  evaluateOverride,
  matchingOverride,
  mergeObjectOverrides,
  normalizeOverrideRegistry,
  overrideById,
  overrideGroup,
  overrideNameTaken,
  overridesForState,
  removeOverride,
  seedOverrideName,
  upsertOverride,
} from "./source-overrides";

const repair = (over: Record<string, unknown> = {}) => ({
  id: "a",
  stateId: "s",
  kind: "repair" as const,
  name: "power",
  ...over,
});

describe("normalizeOverrideRegistry", () => {
  it("parses a registry and rejects junk", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [{ id: "a", stateId: "s", kind: "repair", name: "power" }],
    });
    expect(reg?.overrides).toHaveLength(1);
    expect(
      normalizeOverrideRegistry({ version: 1, overrides: [{ id: "" }] }),
    ).toBeNull();
    expect(normalizeOverrideRegistry("x")).toBeNull();
  });

  it("reads the stored form: JSON string or { val } envelope", () => {
    const doc = { version: 1, updatedAt: 5, overrides: [repair()] };
    expect(
      normalizeOverrideRegistry(JSON.stringify(doc))?.overrides,
    ).toHaveLength(1);
    expect(
      normalizeOverrideRegistry({ val: JSON.stringify(doc) })?.overrides,
    ).toHaveLength(1);
    expect(normalizeOverrideRegistry({ val: doc })?.overrides).toHaveLength(1);
  });

  it("drops entries without an id, stateId or name", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [
        { id: "a", stateId: "s", kind: "repair", name: "power" },
        { id: "b", stateId: "", kind: "repair", name: "power" },
        { id: "c", stateId: "s", kind: "repair", name: " " },
        { stateId: "s", kind: "repair", name: "power" },
      ],
    });
    expect(reg?.overrides.map((o) => o.id)).toEqual(["a"]);
  });

  it("keeps only repair and derived, preserving optional fields", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [
        repair({
          kind: "other",
        }),
        repair({
          id: "b",
          kind: "derived",
          unit: "°C",
          expr: "$.temp",
          inputs: ["s.temp"],
          transform: {
            read: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
          },
        }),
      ],
    });
    expect(reg?.overrides.map((o) => o.id)).toEqual(["b"]);
    expect(reg?.overrides[0].unit).toBe("°C");
    expect(reg?.overrides[0].expr).toBe("$.temp");
    expect(reg?.overrides[0].inputs).toEqual(["s.temp"]);
    expect(reg?.overrides[0].transform?.read?.kind).toBe("scale");
  });

  it("keeps an empty list and the migration marker", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 0,
      overrides: [],
      migratedDevices: true,
    });
    expect(reg?.overrides).toEqual([]);
    expect(reg?.migratedDevices).toBe(true);
  });

  it("rejects a document without an overrides array", () => {
    expect(normalizeOverrideRegistry({ version: 1, updatedAt: 5 })).toBeNull();
    expect(
      normalizeOverrideRegistry({ version: 1, overrides: "x" }),
    ).toBeNull();
  });
});

describe("registry lookups", () => {
  it("finds by id and by state", () => {
    const reg = upsertOverride(
      upsertOverride(emptyOverrideRegistry(), repair({ id: "a" })),
      repair({ id: "b", stateId: "other" }),
    );
    expect(overrideById(reg, "b")?.stateId).toBe("other");
    expect(overrideById(reg, "missing")).toBeUndefined();
    expect(overridesForState(reg, "s").map((o) => o.id)).toEqual(["a"]);
    expect(overridesForState(reg, "other").map((o) => o.id)).toEqual(["b"]);
  });

  it("keeps names unique per state, case-insensitive", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "Power",
    });
    expect(overrideNameTaken(reg, "s", "power")).toBe(true);
    expect(overrideNameTaken(reg, "s", " POWER ")).toBe(true);
    expect(overrideNameTaken(reg, "s", "power", "a")).toBe(false);
    expect(overrideNameTaken(reg, "other", "power")).toBe(false);
    expect(overrideNameTaken(reg, "s", "  ")).toBe(false);
  });
});

/** A sibling group under `s.` plus the live values the evaluator reads. */
function fixtureGroup(
  values: Record<string, number>,
  overrides: SourceOverride[] = [],
) {
  const objects = new Map<string, any>();
  const states = new Map<string, any>();
  for (const [name, value] of Object.entries(values)) {
    const stateId = `s.0.${name}`;
    objects.set(stateId, { type: "state", common: { name, type: "number" } });
    states.set(stateId, { val: value });
  }
  const registry: OverrideRegistry = { version: 1, updatedAt: 0, overrides };
  return {
    group: overrideGroup("s.0.temperature", objects, registry),
    registry,
    states,
    objects,
  };
}

const derived = (
  expr: string,
  more: Partial<SourceOverride> = {},
): SourceOverride => ({
  id: "d",
  stateId: "s.0.temperature",
  kind: "derived",
  name: "dewPoint",
  expr,
  ...more,
});

describe("overrideGroup", () => {
  it("names the anchor and its siblings from the id leaf", () => {
    const ctx = fixtureGroup({ temperature: 21, humidity: 50 });
    expect([...ctx.group.names.keys()]).toEqual(["temperature", "humidity"]);
    expect(ctx.group.names.get("humidity")).toEqual({
      stateId: "s.0.humidity",
    });
    expect(ctx.group.stateIds).toEqual(["s.0.temperature", "s.0.humidity"]);
  });

  it("adds the broker name as an alias of its id leaf", () => {
    const objects = new Map<string, any>([
      ["aaa.0.xxx.yyy", { type: "channel", common: {} }],
      [
        "aaa.0.xxx.yyy.humidity",
        { type: "state", common: { name: { de: "Feuchtigkeit" } } },
      ],
      [
        "aaa.0.xxx.yyy.temperature",
        { type: "state", common: { name: { de: "Temperatur" } } },
      ],
    ]);
    const names = overrideGroup(
      "aaa.0.xxx.yyy.humidity",
      objects,
      emptyOverrideRegistry(),
    ).names;
    expect(names.get("humidity")?.stateId).toBe("aaa.0.xxx.yyy.humidity");
    expect(names.get("feuchtigkeit")?.stateId).toBe("aaa.0.xxx.yyy.humidity");
    expect(names.get("temperature")?.stateId).toBe("aaa.0.xxx.yyy.temperature");
  });

  it("names only the nearest device's direct states, not the adapter", () => {
    const objects = new Map<string, any>([
      ["zigbee.0", { type: "adapter", common: {} }],
      [
        "zigbee.0.a4c13804b536ffc1",
        { type: "device", common: { name: "Sensor" } },
      ],
      [
        "zigbee.0.a4c13804b536ffc1.humidity",
        { type: "state", common: { name: "Feuchtigkeit" } },
      ],
      [
        "zigbee.0.a4c13804b536ffc1.temperature",
        { type: "state", common: { name: "Temperatur" } },
      ],
      ...Array.from(
        { length: 100 },
        (_, i) =>
          [
            `zigbee.0.other${i}`,
            { type: "state", common: { name: `Other ${i}` } },
          ] as [string, any],
      ),
    ]);
    const group = overrideGroup(
      "zigbee.0.a4c13804b536ffc1.humidity",
      objects,
      emptyOverrideRegistry(),
    );
    expect([...group.names.keys()].sort()).toEqual([
      "feuchtigkeit",
      "humidity",
      "temperatur",
      "temperature",
    ]);
    expect(group.names.size).toBe(4);
  });

  it("lets an override name win over a raw sibling", () => {
    const ctx = fixtureGroup({ temperature: 21 }, [
      {
        id: "o",
        stateId: "s.0.temperature",
        kind: "repair",
        name: "temperature",
        unit: "°F",
      },
    ]);
    expect(ctx.group.names.get("temperature")?.override).toBe("o");
    // The raw state keeps its broker name as the secondary alias.
    expect(ctx.group.names.get("temperature2")).toBeUndefined();
  });

  it("skips a raw leaf claimed by an override", () => {
    const objects = new Map<string, any>([
      [
        "aaa.0.xxx.yyy.humidity",
        { type: "state", common: { name: "Feuchtigkeit" } },
      ],
      [
        "aaa.0.xxx.yyy.temperature",
        { type: "state", common: { name: "Temperatur" } },
      ],
    ]);
    const registry = upsertOverride(emptyOverrideRegistry(), {
      id: "o",
      stateId: "aaa.0.xxx.yyy.humidity",
      kind: "repair",
      name: "temperature",
    });
    const group = overrideGroup("aaa.0.xxx.yyy.humidity", objects, registry);
    expect(group.names.get("temperature")).toEqual({
      stateId: "aaa.0.xxx.yyy.humidity",
      override: "o",
    });
  });

  it("keeps the id leaf when common.name is localized", () => {
    const objects = new Map<string, any>([
      [
        "s.0.temperature",
        {
          type: "state",
          common: { name: { en: "Temperature", de: "Temperatur" } },
        },
      ],
      [
        "s.0.humidity",
        {
          type: "state",
          common: { name: { en: "Humidity", de: "Luftfeuchte" } },
        },
      ],
    ]);
    const group = overrideGroup(
      "s.0.temperature",
      objects,
      emptyOverrideRegistry(),
    );
    // The names the app localizes to are the leaves again: no duplicate alias.
    expect([...group.names.keys()]).toEqual(["temperature", "humidity"]);
  });

  it("adds a shared broker name as an alias once", () => {
    const objects = new Map<string, any>([
      ["s.0.a", { type: "state", common: { name: "value" } }],
      ["s.0.b", { type: "state", common: { name: "Value" } }],
    ]);
    const group = overrideGroup("s.0.a", objects, emptyOverrideRegistry());
    expect(group.names.get("a")?.stateId).toBe("s.0.a");
    expect(group.names.get("b")?.stateId).toBe("s.0.b");
    expect(group.names.get("value")?.stateId).toBe("s.0.a");
    expect(group.names.size).toBe(3);
  });

  it("reads the alias base's group", () => {
    const objects = new Map<string, any>([
      ["shelly.0", { type: "device", common: { name: "Shelly" } }],
      [
        "shelly.0.temp",
        { type: "state", common: { name: "temperature", type: "number" } },
      ],
      [
        "shelly.0.hum",
        { type: "state", common: { name: "humidity", type: "number" } },
      ],
      [
        "alias.0.dew",
        {
          type: "state",
          common: {
            name: "dew point",
            alias: { id: "shelly.0.temp" },
          },
        },
      ],
    ]);
    const states = new Map<string, any>([
      ["shelly.0.temp", { val: 21 }],
      ["shelly.0.hum", { val: 50 }],
    ]);
    const registry = emptyOverrideRegistry();
    const group = overrideGroup("alias.0.dew", objects, registry);
    // The leaf names the state; the broker names stay reachable as aliases.
    expect(group.names.get("temp")?.stateId).toBe("shelly.0.temp");
    expect(group.names.get("temperature")?.stateId).toBe("shelly.0.temp");
    expect(group.names.get("hum")?.stateId).toBe("shelly.0.hum");
    const res = evaluateOverride(derived("$.temperature + $.humidity"), {
      group,
      states,
      registry,
      objects,
    });
    expect(res.value).toBe(71);
  });

  it("resolves a variable as the anchor", () => {
    const { objects, registry } = fixtureGroup({ temperature: 21 });
    const variables: GlobalVariable[] = [
      {
        id: "v",
        name: "Outside_temp",
        kind: "state",
        type: "number",
        stateId: "s.0.temperature",
      },
    ];
    const group = overrideGroup("Outside_temp", objects, registry, variables);
    expect(group.stateIds).toContain("s.0.temperature");
  });
});

describe("seedOverrideName", () => {
  const object = { common: { name: "Feuchtigkeit" } };

  it("names a new override from the id leaf, the broker name as label", () => {
    expect(seedOverrideName("aaa.0.xxx.yyy.humidity", object, [])).toEqual({
      name: "humidity",
      label: "Feuchtigkeit",
    });
  });

  it("drops the label when it is the leaf", () => {
    expect(
      seedOverrideName("aaa.0.xxx.yyy.humidity", {
        common: { name: "humidity" },
      }),
    ).toEqual({ name: "humidity", label: undefined });
    expect(seedOverrideName("aaa.0.xxx.yyy.humidity", undefined)).toEqual({
      name: "humidity",
      label: undefined,
    });
  });

  it("suffixes a name the state already uses", () => {
    expect(
      seedOverrideName("aaa.0.xxx.yyy.humidity", object, [
        "Humidity",
        "humidity2",
      ]).name,
    ).toBe("humidity3");
  });
});

describe("evaluateOverride", () => {
  it("resolves a sibling by $.name", () => {
    const expr =
      "(237.7 * (Math.log($.humidity / 100) + (17.27 * $.temperature) / (237.7 + $.temperature))) / (17.27 - (Math.log($.humidity / 100) + (17.27 * $.temperature) / (237.7 + $.temperature)))";
    // 20 °C / 50 % RH → 9.26 °C (the brief's 9.3). At 21 °C the same formula
    // gives 10.17, so the fixture keeps the brief's expected value.
    const ctx = fixtureGroup({ temperature: 20, humidity: 50 });
    const res = evaluateOverride(derived(expr), ctx);
    expect(res.value).toBeCloseTo(9.3, 0);
    expect(res.inputs).toEqual(["s.0.humidity", "s.0.temperature"]);
  });

  it("reports a missing sibling and keeps inputs", () => {
    const res = evaluateOverride(
      derived("$.nope + 1"),
      fixtureGroup({ temperature: 21 }),
    );
    expect(res.value).toBeUndefined();
    expect(res.error).toContain("nope");
    expect(res.inputs).toEqual([]);
  });

  it("applies a repair override's transform to the sibling", () => {
    const ctx = fixtureGroup({ temperature: 21 }, [
      {
        id: "o",
        stateId: "s.0.temperature",
        kind: "repair",
        name: "temperature",
        transform: { read: { kind: "formula", expr: "x * 2" } },
      },
    ]);
    const res = evaluateOverride(derived("$.temperature"), ctx);
    expect(res.value).toBe(42);
    expect(res.inputs).toEqual(["s.0.temperature"]);
  });

  it("coerces a repaired sibling's text by its declared type", () => {
    const ctx = fixtureGroup({ temperature: 0 }, [
      {
        id: "o",
        stateId: "s.0.temperature",
        kind: "repair",
        name: "temperature",
        type: "number",
      },
    ]);
    ctx.objects.get("s.0.temperature").common.type = "string";
    ctx.states.set("s.0.temperature", { val: "12" });
    const res = evaluateOverride(derived("$.temperature + 1"), ctx);
    expect(res.value).toBe(13);
  });

  it("refuses another derived override as a sibling", () => {
    const ctx = fixtureGroup({ temperature: 21, humidity: 50 }, [
      {
        id: "dd",
        stateId: "s.0.humidity",
        kind: "derived",
        name: "humidity",
        expr: "1",
      },
    ]);
    const res = evaluateOverride(derived("$.humidity * 2"), ctx);
    expect(res.value).toBeUndefined();
    expect(res.error).toContain("humidity");
  });

  it("reads get() ids outside the group and lists them as inputs", () => {
    const ctx = fixtureGroup({ temperature: 21 });
    ctx.objects.set("other.pressure", {
      type: "state",
      common: { name: "pressure" },
    });
    ctx.states.set("other.pressure", { val: 1000 });
    const res = evaluateOverride(
      derived('$.temperature + get("other.pressure")'),
      ctx,
    );
    expect(res.value).toBe(1021);
    expect(res.inputs).toEqual(["s.0.temperature", "other.pressure"]);
  });

  it("rounds the result to precision", () => {
    const ctx = fixtureGroup({ temperature: 21.26 });
    expect(
      evaluateOverride(derived("$.temperature", { precision: 1 }), ctx).value,
    ).toBe(21.3);
  });
});

describe("upsertOverride / removeOverride", () => {
  it("upserts by id and removes by id", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "power",
    });
    const updated = upsertOverride(reg, {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "switch",
    });
    expect(updated.overrides).toHaveLength(1);
    expect(updated.overrides[0].name).toBe("switch");
    expect(removeOverride(updated, "a").overrides).toEqual([]);
  });

  it("appends a new id and never mutates the input", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), repair());
    const next = upsertOverride(reg, repair({ id: "b" }));
    expect(reg.overrides).toHaveLength(1);
    expect(next.overrides.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("does not bump updatedAt and keeps the migration marker", () => {
    const base = {
      ...emptyOverrideRegistry(),
      updatedAt: 7,
      migratedDevices: true,
    };
    const next = upsertOverride(base, repair());
    expect(next.updatedAt).toBe(7);
    expect(next.migratedDevices).toBe(true);
    expect(removeOverride(next, "a").updatedAt).toBe(7);
  });
});

describe("ensureRepairOverride", () => {
  it("reuses an existing repair by role or name and never duplicates it", () => {
    const base = {
      ...emptyOverrideRegistry(),
      overrides: [repair({ role: "switch", name: "lamp" })],
    };
    const byRole = ensureRepairOverride(base, "s", {
      kind: "repair",
      name: "switch",
      role: "switch",
    });
    expect(byRole.id).toBe("a");
    expect(byRole.name).toBe("lamp");
    expect(byRole.registry).toBe(base);
    const byName = ensureRepairOverride(base, "s", {
      kind: "repair",
      name: "lamp",
      role: "switch.light",
    });
    expect(byName.id).toBe("a");
    expect(byName.name).toBe("lamp");
    // A derived override with the same name is not a repair to reuse.
    const withDerived = {
      ...emptyOverrideRegistry(),
      overrides: [
        {
          ...repair({ id: "d", role: "value.power" }),
          kind: "derived" as const,
        },
      ],
    };
    const created = ensureRepairOverride(withDerived, "s", {
      kind: "repair",
      name: "power",
      role: "value.power",
    });
    expect(created.id).not.toBe("d");
    expect(created.name).toBe("power2");
    expect(created.registry.overrides).toHaveLength(2);
    expect(
      created.registry.overrides.find((o) => o.id === created.id)?.name,
    ).toBe("power2");
  });

  it("matches only the same state and keeps the repair's fields", () => {
    const reg = ensureRepairOverride(emptyOverrideRegistry(), "state.one", {
      kind: "repair",
      name: "power",
      label: "Power",
      unit: "W",
      role: "value.power",
    });
    expect(
      matchingOverride(reg.registry.overrides, "state.two", {
        name: "power",
      }),
    ).toBeUndefined();
    expect(reg.registry.overrides[0]).toMatchObject({
      stateId: "state.one",
      name: "power",
      unit: "W",
      kind: "repair",
    });
  });
});

describe("variable-named state ids", () => {
  const variables: GlobalVariable[] = [
    {
      id: "v",
      name: "LampVar",
      kind: "state",
      type: "boolean",
      stateId: "0_userdata.0.lamp",
    },
  ];

  it("finds an override stored under a variable name by the real state id", () => {
    const reg = upsertOverride(
      emptyOverrideRegistry(),
      repair({ stateId: "LampVar" }),
    );
    expect(
      overridesForState(reg, "0_userdata.0.lamp", variables).map((o) => o.id),
    ).toEqual(["a"]);
  });

  it("checks names against the state a variable names", () => {
    const reg = upsertOverride(
      emptyOverrideRegistry(),
      repair({ stateId: "LampVar" }),
    );
    expect(
      overrideNameTaken(
        reg,
        "0_userdata.0.lamp",
        " POWER ",
        undefined,
        variables,
      ),
    ).toBe(true);
    expect(
      overrideNameTaken(reg, "0_userdata.0.lamp", "power", "a", variables),
    ).toBe(false);
  });
});

describe("mergeObjectOverrides", () => {
  const objectWith = (...overrides: unknown[]) => ({
    common: { custom: { ihome: { version: 1, overrides } } },
  });

  it("adds object-only overrides and keeps list-only entries", () => {
    const reg: OverrideRegistry = {
      ...emptyOverrideRegistry(),
      overrides: [repair({ id: "list", stateId: "a", name: "level" })],
    };
    const merged = mergeObjectOverrides(reg, [
      objectWith(repair({ id: "obj", stateId: "b", name: "sum" })),
    ]);
    expect(merged.overrides.map((o) => o.id).sort()).toEqual(["list", "obj"]);
  });

  it("lets object metadata win for the same state and name", () => {
    const reg: OverrideRegistry = {
      ...emptyOverrideRegistry(),
      overrides: [repair({ id: "a", stateId: "s", name: "level" })],
    };
    const merged = mergeObjectOverrides(reg, [
      objectWith(repair({ id: "b", stateId: "s", name: "level", min: 5 })),
    ]);
    expect(merged.overrides).toMatchObject([{ id: "b", min: 5 }]);
  });

  it("keeps several overrides on one state", () => {
    const merged = mergeObjectOverrides(emptyOverrideRegistry(), [
      objectWith(repair({ id: "a", stateId: "s", name: "level" }), {
        ...repair({ id: "b", stateId: "s", name: "sum" }),
        kind: "derived",
      }),
    ]);
    expect(merged.overrides).toHaveLength(2);
  });

  it("ignores other adapters' custom keys", () => {
    const merged = mergeObjectOverrides(emptyOverrideRegistry(), [
      { common: { custom: { "history.0": { enabled: true } } } },
    ]);
    expect(merged.overrides).toEqual([]);
  });
});
