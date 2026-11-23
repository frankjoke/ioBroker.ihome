import { describe, expect, it } from "vitest";
import {
  commonProblem,
  newStateObject,
  settableCommonObject,
  stateIdProblem,
} from "./state-common";

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
    expect(
      commonProblem({ states: { "0": "Idle", "1": "Busy" }, type: "number" }),
    ).toBeNull();
  });

  it("rejects enum labels that are not text", () => {
    expect(commonProblem({ states: [1, 2] })).toMatch(/labels/i);
    expect(commonProblem({ states: { "0": 1 } })).toMatch(/label/i);
    expect(commonProblem({ states: null })).toBeNull();
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

describe("new states", () => {
  it("validates the id shape", () => {
    expect(stateIdProblem("0_userdata.0.lamp")).toBeNull();
    expect(stateIdProblem(" 0_userdata.0.lamp ")).toBeNull();
    expect(stateIdProblem("")).toMatch(/id/i);
    expect(stateIdProblem("lamp")).toMatch(/namespace/i);
    expect(stateIdProblem("0_userdata..lamp")).toMatch(/segment/i);
    expect(stateIdProblem("0_userdata.0.my lamp")).toMatch(/spaces/i);
    expect(stateIdProblem("0_userdata.0.*")).toMatch(/wildcards/i);
    expect(stateIdProblem("system.host.x")).toMatch(/system/i);
  });

  it("builds a state with readable defaults", () => {
    expect(
      newStateObject("0_userdata.0.lamp", {
        name: "Lamp",
        type: "number",
        role: "level",
        unit: "%",
        read: true,
        write: false,
      }),
    ).toEqual({
      _id: "0_userdata.0.lamp",
      type: "state",
      common: {
        name: "Lamp",
        type: "number",
        role: "level",
        unit: "%",
        read: true,
        write: false,
      },
      native: {},
    });
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

  it("replaces or removes enum labels", () => {
    const object = {
      type: "state",
      common: { name: "X", type: "number", states: { "0": "Off" } },
      native: {},
    };
    const replaced = settableCommonObject(object, {
      states: { "0": "Idle", "1": "Busy" },
    }).common as Record<string, unknown>;
    expect(replaced.states).toEqual({ "0": "Idle", "1": "Busy" });
    const removed = settableCommonObject(object, { states: null })
      .common as Record<string, unknown>;
    expect("states" in removed).toBe(false);
  });
});
