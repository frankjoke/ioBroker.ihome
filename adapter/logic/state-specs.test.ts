import { describe, expect, it } from "vitest";
import { logicOutputSpec, numberStatesOf } from "./state-specs";
import type { FunctionLogic, MachineLogic } from "./types";

const fn = (output: FunctionLogic["output"]): FunctionLogic => ({
  id: "calc",
  name: "Calc",
  kind: "function",
  expr: { code: "0" },
  output,
});

const machine = (): MachineLogic => ({
  id: "light",
  name: "Light",
  kind: "machine",
  states: { Idle: {}, On: {} },
  output: { scope: "logic", type: "number", unit: "lx" },
});

describe("numberStatesOf", () => {
  it("maps machine state names to indexes", () => {
    expect(numberStatesOf(machine())).toEqual({ "0": "Idle", "1": "On" });
    expect(numberStatesOf(fn({ scope: "logic", type: "number" }))).toBe(
      undefined,
    );
  });
});

describe("logicOutputSpec", () => {
  it("builds a boolean output", () => {
    expect(
      logicOutputSpec(fn({ scope: "logic", type: "boolean" }), "ihome.0"),
    ).toEqual({
      id: "ihome.0.Logic.calc",
      common: {
        name: "Calc",
        type: "boolean",
        role: "level.switch",
        read: true,
        write: true,
        unit: "",
        states: {},
        def: false,
      },
    });
  });

  it("builds a number output with states and unit", () => {
    expect(logicOutputSpec(machine(), "ihome.0")).toMatchObject({
      id: "ihome.0.Logic.light",
      common: {
        type: "number",
        role: "level.state",
        unit: "lx",
        states: { "0": "Idle", "1": "On" },
        def: 0,
      },
    });
  });

  it("stores an object output as JSON text", () => {
    expect(
      logicOutputSpec(fn({ scope: "logic", type: "object" }), "ihome.0"),
    ).toMatchObject({
      common: {
        type: "string",
        role: "json",
        def: "{}",
        states: {},
      },
    });
  });

  it("returns undefined for memory and state outputs", () => {
    expect(logicOutputSpec(fn({ scope: "memory" }), "ihome.0")).toBeUndefined();
    expect(
      logicOutputSpec(
        fn({ scope: "state", ref: "0_userdata.0.X", type: "boolean" }),
        "ihome.0",
      ),
    ).toBeUndefined();
  });
});
