import { describe, expect, it } from "vitest";
import type { GlobalVariable } from "./variables";
import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";
import {
  emptyOverrideRegistry,
  evaluateOverride,
  normalizeOverrideRegistry,
  overrideById,
  overrideGroup,
  overrideNameTaken,
  overridesForState,
  removeOverride,
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
  it("names the anchor and its siblings from common.name", () => {
    const ctx = fixtureGroup({ temperature: 21, humidity: 50 });
    expect([...ctx.group.names.keys()]).toEqual(["temperature", "humidity"]);
    expect(ctx.group.names.get("humidity")).toEqual({
      stateId: "s.0.humidity",
    });
    expect(ctx.group.stateIds).toEqual(["s.0.temperature", "s.0.humidity"]);
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
  });

  it("suffixes duplicate sibling names", () => {
    const objects = new Map<string, any>([
      ["s.0.a", { type: "state", common: { name: "value" } }],
      ["s.0.b", { type: "state", common: { name: "Value" } }],
    ]);
    const group = overrideGroup("s.0.a", objects, emptyOverrideRegistry());
    expect([...group.names.keys()]).toEqual(["value", "value2"]);
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
