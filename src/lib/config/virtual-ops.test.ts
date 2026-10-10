import { describe, it, expect } from "vitest";
import {
  sanitizeLabel,
  evaluateVirtual,
  roundValue,
  buildScope,
  computeVirtual,
  type PoolEntry,
  type LocalControl,
} from "$lib/config/virtual-ops";

describe("sanitizeLabel", () => {
  it("lowercases and replaces non-identifier characters", () => {
    expect(sanitizeLabel("Dew Point", new Set())).toBe("dew_point");
  });
  it("suffixes collisions with an index", () => {
    const taken = new Set<string>();
    expect(sanitizeLabel("Temperature", taken)).toBe("temperature");
    expect(sanitizeLabel("Temperature", taken)).toBe("temperature2");
    expect(sanitizeLabel("temperature", taken)).toBe("temperature3");
  });
  it("falls back for an empty label or one starting with a digit", () => {
    expect(sanitizeLabel("", new Set())).toBe("v");
    expect(sanitizeLabel("1st", new Set())).toBe("v_1st");
  });
});

describe("evaluateVirtual", () => {
  it("evaluates an expression against locals", () => {
    const r = evaluateVirtual("temperature - (100 - humidity) / 5", {
      locals: { temperature: 20, humidity: 50 },
      helpers: {},
    });
    expect(r.value).toBe(10);
    expect(r.error).toBeUndefined();
  });
  it("reports a syntax error without throwing", () => {
    const r = evaluateVirtual("1 +", { locals: {}, helpers: {} });
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
  it("reports an unknown variable without throwing", () => {
    const r = evaluateVirtual("nope + 1", { locals: { x: 1 }, helpers: {} });
    expect(r.error).toBeTruthy();
  });
  it("returns an error for an empty expression", () => {
    expect(
      evaluateVirtual("   ", { locals: {}, helpers: {} }).error,
    ).toBeTruthy();
  });
});

describe("roundValue", () => {
  it("rounds numbers to the given precision", () => {
    expect(roundValue(10.129, 2)).toBe(10.13);
  });
  it("passes non-numbers and undefined precision through", () => {
    expect(roundValue("x", 2)).toBe("x");
    expect(roundValue(10.129, undefined)).toBe(10.129);
  });
});

const pool: PoolEntry[] = [
  {
    stateId: "a.0.temp",
    value: 21,
    role: "value.temperature",
    room: "Kitchen",
    device: "Kitchen.Thermometer",
    feature: "temperature",
    label: "Temperature",
  },
  {
    stateId: "a.0.hum",
    value: 55,
    role: "value.humidity",
    room: "Kitchen",
    device: "Kitchen.Thermometer",
    feature: "humidity",
    label: "Humidity",
  },
  {
    stateId: "b.0.bat",
    value: 15,
    role: "value.battery",
    room: "Hall",
    device: "Hall.Sensor",
    feature: "battery",
    label: "Battery",
  },
  {
    stateId: "c.0.mot",
    value: true,
    role: "sensor.motion",
    room: "Hall",
    device: "Hall.Motion",
    feature: "motion",
    label: "Motion",
  },
  {
    stateId: "d.0.non",
    value: "n/a",
    role: "value",
    room: "Hall",
    device: "Hall.Sensor",
    feature: "value",
    label: "Raw",
  },
];

const siblings: LocalControl[] = [
  {
    kind: "state",
    label: "Temperature",
    feature: "temperature",
    liveValue: 21,
  },
  { kind: "state", label: "Humidity", feature: "humidity", liveValue: 55 },
];

describe("buildScope", () => {
  it("binds state controls by sanitized label", () => {
    const { locals } = buildScope(siblings, pool);
    expect(locals.temperature).toBe(21);
    expect(locals.humidity).toBe(55);
  });
  it("excludes virtual controls from locals", () => {
    const { locals } = buildScope(
      [
        ...siblings,
        { kind: "virtual", label: "Dew", feature: "value", liveValue: 9 },
      ],
      pool,
    );
    expect(locals.dew).toBeUndefined();
  });
  it("suffixes colliding labels so both resolve", () => {
    const { locals } = buildScope(
      [
        { kind: "state", label: "Temperature", liveValue: 1 },
        { kind: "state", label: "Temperature", liveValue: 2 },
      ],
      pool,
    );
    expect(locals.temperature).toBe(1);
    expect(locals.temperature2).toBe(2);
  });
});

describe("helpers", () => {
  it("count with a predicate", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.count({ role: "battery" }, (v: number) => v < 20)).toBe(1);
  });
  it("sum / any / all over a filter", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.sum({ feature: "temperature" })).toBe(21);
    expect(helpers.any({ role: "motion" })).toBe(true);
    expect(
      helpers.all({ room: "Kitchen" }, (v: unknown) => typeof v === "number"),
    ).toBe(true);
  });
  it("ignores non-numeric values in numeric aggregates", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.sum({ room: "Hall" })).toBe(16);
  });
  it("get by explicit device + label (case-insensitive label)", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(
      helpers.get({ device: "Kitchen.Thermometer", label: "humidity" }),
    ).toBe(55);
  });
  it("device(name) exposes that device's values by sanitized label", () => {
    const { helpers } = buildScope(siblings, pool);
    expect((helpers.device("Kitchen.Thermometer") as any).humidity).toBe(55);
  });
  it("empty-set semantics", () => {
    const { helpers } = buildScope(siblings, pool);
    expect(helpers.count({ role: "nope" })).toBe(0);
    expect(helpers.sum({ role: "nope" })).toBe(0);
    expect(helpers.any({ role: "nope" })).toBe(false);
    expect(helpers.all({ role: "nope" })).toBe(true);
    expect(helpers.avg({ role: "nope" })).toBeUndefined();
    expect(helpers.min({ role: "nope" })).toBeUndefined();
    expect(helpers.max({ role: "nope" })).toBeUndefined();
  });
});

describe("computeVirtual", () => {
  it("computes dew point from locals", () => {
    const r = computeVirtual(
      { virtual: { expr: "temperature - (100 - humidity) / 5" } },
      siblings,
      pool,
    );
    expect(r.value).toBe(12);
  });
  it("applies precision", () => {
    const r = computeVirtual(
      { virtual: { expr: "humidity / 7", precision: 2 } },
      siblings,
      pool,
    );
    expect(r.value).toBe(7.86);
  });
  it("reports errors for a bad expression", () => {
    expect(
      computeVirtual({ virtual: { expr: "temperature +" } }, siblings, pool)
        .error,
    ).toBeTruthy();
  });
  it("yields undefined + error when a named sibling is missing", () => {
    const r = computeVirtual(
      { virtual: { expr: "ghost * 2" } },
      siblings,
      pool,
    );
    expect(r.value).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
});
