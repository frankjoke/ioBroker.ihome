import { describe, it, expect } from "vitest";
import {
  sanitizeLabel,
  evaluateVirtual,
  roundValue,
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
