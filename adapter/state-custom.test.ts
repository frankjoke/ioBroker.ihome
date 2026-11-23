import { describe, expect, it } from "vitest";
import { customProblem, settableCustomObject } from "./state-custom";

describe("customProblem", () => {
  it("accepts an object and rejects other shapes", () => {
    expect(customProblem({ a: 1 })).toBeNull();
    expect(customProblem([])).toMatch(/object/i);
    expect(customProblem("x")).toMatch(/object/i);
    expect(customProblem(undefined)).toMatch(/object/i);
  });

  it("refuses an oversized object", () => {
    expect(customProblem({ text: "x".repeat(70_000) })).toMatch(/large/i);
  });
});

describe("settableCustomObject", () => {
  it("writes only type/native/common and preserves other common fields", () => {
    const object = {
      _id: "s",
      type: "state",
      from: "old",
      ts: 1,
      common: { name: "X", custom: { "history.0": { enabled: true } } },
      native: { keep: 1 },
    };
    expect(settableCustomObject(object, { "influxdb.0": {} })).toEqual({
      type: "state",
      native: { keep: 1 },
      common: { name: "X", custom: { "influxdb.0": {} } },
    });
  });
});
