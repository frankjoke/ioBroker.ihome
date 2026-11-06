import { describe, expect, it } from "vitest";
import {
  isOwnedState,
  normalizeStates,
  stateCommonDiff,
} from "./state-common";

describe("normalizeStates", () => {
  it("accepts an object or a JSON string", () => {
    expect(normalizeStates({ "0": "Off" })).toEqual({ "0": "Off" });
    expect(normalizeStates('{"1":"On","0":"Off"}')).toEqual({
      "0": "Off",
      "1": "On",
    });
  });

  it("returns undefined for absent or invalid input", () => {
    expect(normalizeStates(undefined)).toBeUndefined();
    expect(normalizeStates("{")).toBeUndefined();
  });
});

describe("isOwnedState", () => {
  it("only accepts ids below the namespace", () => {
    expect(isOwnedState("ihome.0.Variables.x", "ihome.0")).toBe(true);
    expect(isOwnedState("0_userdata.0.x", "ihome.0")).toBe(false);
    expect(isOwnedState("ihome.00.x", "ihome.0")).toBe(false);
  });
});

describe("stateCommonDiff", () => {
  it("returns null when the owned common is equal", () => {
    expect(
      stateCommonDiff(
        {
          name: "Power",
          type: "boolean",
          role: "switch",
          read: true,
          write: true,
          unit: "",
          states: {},
          def: false,
          custom: "keep",
        },
        {
          name: "Power",
          type: "boolean",
          role: "switch",
          read: true,
          write: true,
          unit: "",
          states: {},
          def: false,
        },
      ),
    ).toBeNull();
  });

  it("returns only the changed keys", () => {
    expect(
      stateCommonDiff(
        { name: "Power", type: "boolean", role: "switch" },
        { name: "Power", type: "string", role: "switch" },
      ),
    ).toEqual({ type: "string" });
  });

  it("treats object and JSON-string states as equal", () => {
    expect(
      stateCommonDiff(
        { states: { "1": "On", "0": "Off" } },
        { states: '{"0":"Off","1":"On"}' },
      ),
    ).toBeNull();
  });

  it("returns states when the labels differ", () => {
    expect(
      stateCommonDiff({ states: { "0": "Off" } }, { states: { "0": "Aus" } }),
    ).toEqual({ states: { "0": "Aus" } });
  });

  it("clears stale labels with an empty states object", () => {
    expect(stateCommonDiff({ states: { "0": "Off" } }, { states: {} })).toEqual({
      states: {},
    });
  });

  it("compares def objects canonically", () => {
    expect(
      stateCommonDiff({ def: { a: 1, b: 2 } }, { def: { b: 2, a: 1 } }),
    ).toBeNull();
  });

  it("compares min, max and step", () => {
    expect(
      stateCommonDiff(
        { min: 0, max: 100, step: 1 },
        { min: 0, max: 50, step: 1 },
      ),
    ).toEqual({ max: 50 });
  });

  it("returns the whole desired common when the object is missing", () => {
    const desired = { name: "x", type: "string" };
    expect(stateCommonDiff(undefined, desired)).toEqual(desired);
  });

  it("ignores keys not present in the desired common", () => {
    expect(
      stateCommonDiff({ name: "x", unit: "V", custom: "keep" }, { name: "x" }),
    ).toBeNull();
  });
});
