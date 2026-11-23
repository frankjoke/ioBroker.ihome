import { describe, expect, it } from "vitest";
import { commonProblem, settableCommonObject } from "./state-common";

describe("commonProblem", () => {
  it("accepts the editable state fields", () => {
    expect(
      commonProblem({
        name: "Lamp",
        role: "level",
        type: "number",
        unit: "%",
        desc: "Hall",
        min: 0,
        max: 100,
        step: 1,
        read: true,
        write: true,
      }),
    ).toBeNull();
    expect(commonProblem({ min: null, max: null, step: null })).toBeNull();
  });

  it("rejects an empty name, an unknown type and bad field shapes", () => {
    expect(commonProblem({ name: "  " })).toMatch(/name/i);
    expect(commonProblem({ name: 4 })).toMatch(/name/i);
    expect(commonProblem({ type: "numeric" })).toMatch(/type/i);
    expect(commonProblem({ role: 1 })).toMatch(/role/i);
    expect(commonProblem({ min: Number.NaN })).toMatch(/min/i);
    expect(commonProblem({ min: "1" })).toMatch(/min/i);
    expect(commonProblem({ read: "yes" })).toMatch(/read/i);
    expect(commonProblem([])).toMatch(/object/i);
  });
});

describe("settableCommonObject", () => {
  it("merges the editable fields and preserves custom and native", () => {
    const object = {
      _id: "s",
      type: "state",
      from: "old",
      common: {
        name: "Old",
        type: "number",
        role: "value",
        unit: "",
        custom: { "history.0": {} },
        min: 0,
        max: 10,
        read: true,
        write: false,
      },
      native: { keep: 1 },
    };
    expect(
      settableCommonObject(object, {
        name: "New",
        role: "level",
        type: "number",
        unit: "%",
        desc: "Hall",
        min: 1,
        max: 20,
        step: 0.5,
        read: true,
        write: true,
      }),
    ).toEqual({
      type: "state",
      native: { keep: 1 },
      common: {
        name: "New",
        type: "number",
        role: "level",
        unit: "%",
        desc: "Hall",
        custom: { "history.0": {} },
        min: 1,
        max: 20,
        step: 0.5,
        read: true,
        write: true,
      },
    });
  });

  it("removes cleared numeric fields", () => {
    const object = {
      type: "state",
      common: { name: "X", type: "number", min: 0, max: 10, step: 1 },
      native: {},
    };
    expect(
      (
        settableCommonObject(object, { min: null, max: null, step: null })
          .common as Record<string, unknown>
      ).min,
    ).toBeUndefined();
    const common = settableCommonObject(object, {
      min: null,
      max: null,
      step: null,
    }).common as Record<string, unknown>;
    expect("min" in common).toBe(false);
    expect("max" in common).toBe(false);
    expect("step" in common).toBe(false);
  });
});
