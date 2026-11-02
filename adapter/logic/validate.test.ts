import { expect, it } from "vitest";
import {
  logicHasErrors,
  parseLogicDocument,
  validateLogicDocument,
} from "./validate";
import type { LogicDocument } from "./types";

const doc: LogicDocument = {
  version: 1,
  logics: [
    {
      id: "hallway",
      name: "Hallway",
      kind: "machine",
      inputs: {
        motion: {
          from: { type: "state", ref: "0_userdata.0.Motion" },
          kind: "event",
        },
      },
      output: { scope: "memory" },
      states: {
        Idle: {
          on: [{ on: "motion", is: { op: "eq", value: true }, goto: "On" }],
        },
        On: { after: { time: "2m", goto: "Idle" } },
      },
    },
  ],
};

it("parses a JSON string or object and rejects everything else", () => {
  expect(parseLogicDocument(JSON.stringify(doc))?.logics).toHaveLength(1);
  expect(parseLogicDocument(doc)?.logics).toHaveLength(1);
  for (const bad of [null, "", "{bad", "[1,2]", { version: 2, logics: [] }]) {
    expect(parseLogicDocument(bad)).toBeNull();
  }
});

it("accepts the valid document", () => {
  expect(validateLogicDocument(doc)).toEqual([]);
});

it("reports jump targets, row inputs and maps", () => {
  const broken: LogicDocument = {
    version: 1,
    logics: [
      {
        ...doc.logics[0],
        states: { Idle: { on: [{ on: "ghost", goto: "Nowhere" }] } },
      } as never,
      {
        id: "counter",
        name: "Counter",
        kind: "machine",
        output: { scope: "state", ref: "0_userdata.0.C", type: "number" },
        states: { A: {}, B: {} },
      },
    ],
  };
  const issues = validateLogicDocument(broken);
  expect(issues.some((i) => i.path === "states.Idle.on.0.on")).toBe(true);
  expect(issues.some((i) => i.path === "states.Idle.on.0.goto")).toBe(true);
  expect(logicHasErrors(issues, "counter")).toBe(false);
});

it("rejects noop outside a function expression", () => {
  const bad: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "x",
        name: "X",
        kind: "machine",
        states: {
          A: {
            on: [{ on: "e", is: { op: "eq", value: { noop: true } as never } }],
          },
        },
      },
    ],
  };
  expect(validateLogicDocument(bad).some((i) => i.severity === "error")).toBe(
    true,
  );
});

it("requires a ref and a known type on every state output", () => {
  const bad: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "f",
        name: "F",
        kind: "function",
        expr: { const: 1 },
        output: { scope: "state" } as never,
      },
    ],
  };
  const issues = validateLogicDocument(bad);
  expect(issues.some((i) => i.path === "output.ref")).toBe(true);
  expect(issues.some((i) => i.path === "output.type")).toBe(true);
});

it("does not throw on malformed optional arrays", () => {
  expect(() =>
    validateLogicDocument({ version: 1, logics: [], memory: {} } as never),
  ).not.toThrow();
  expect(() =>
    validateLogicDocument({
      version: 1,
      logics: [
        { id: "x", name: "X", kind: "machine", states: { A: { on: "nope" } } },
      ],
    } as never),
  ).not.toThrow();
});

it("rejects zero-length timers", () => {
  const bad: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "z",
        name: "Z",
        kind: "machine",
        inputs: { t: { from: { type: "timer", every: "0s" }, kind: "event" } },
        states: { A: { after: { time: "0s", goto: "A" } } },
      },
    ],
  };
  const issues = validateLogicDocument(bad);
  expect(issues.some((i) => i.path === "inputs.t.from.every")).toBe(true);
  expect(issues.some((i) => i.path === "states.A.after.time")).toBe(true);
});

it("checks the init policy", () => {
  const bad: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        output: { scope: "memory" },
        init: { match: "output", state: "Nowhere" },
        states: { A: {} },
      },
    ],
  };
  const issues = validateLogicDocument(bad);
  expect(issues.some((i) => i.path === "init.match")).toBe(true);
  expect(issues.some((i) => i.path === "init.state")).toBe(true);
});

it("accepts the string operators and rejects an unknown one", () => {
  const doc = (op: string): LogicDocument => ({
    version: 1,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        inputs: {
          p: {
            from: { type: "state", ref: "0_userdata.0.P" },
            kind: "event",
          },
        },
        init: { state: "A" },
        states: {
          A: { on: [{ on: "p", is: { op: op as never, value: "On*" } }] },
          B: {},
        },
      },
    ],
  });
  expect(validateLogicDocument(doc("startsWith"))).toEqual([]);
  expect(validateLogicDocument(doc("nope")).map((i) => i.message)).toEqual([
    "unknown operator nope",
  ]);
});

it("accepts a $init row and an expression init state", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        inputs: { p: { from: { type: "state", ref: "0_userdata.0.P" } } },
        init: {
          state: {
            op: "if",
            cond: { ref: "p" },
            then: { const: "A" },
            else: { const: "B" },
          },
          run: true,
        },
        states: {
          A: { on: [{ on: "$init", goto: "B" }] },
          B: {},
        },
      },
    ],
  };
  expect(validateLogicDocument(doc)).toEqual([]);
});

it("rejects an unknown event source", () => {
  const bad: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "s",
        name: "S",
        kind: "machine",
        inputs: {
          e: {
            from: { type: "state", ref: "0_userdata.0.E" },
            kind: "event",
            source: "nope" as never,
          },
        },
        states: { A: {} },
      },
    ],
  };
  expect(
    validateLogicDocument(bad).some((i) => i.path === "inputs.e.source"),
  ).toBe(true);
});

it("warns that continue cannot outlive a goto", () => {
  const d: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "c",
        name: "C",
        kind: "machine",
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        states: {
          A: {
            on: [
              { on: "e", continue: true, goto: "B" },
              { on: "e", continue: true, do: [{ goto: "B" }] },
              { on: "e", continue: true },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const issues = validateLogicDocument(d);
  expect(
    issues.filter((i) => i.path.endsWith(".continue")).map((i) => i.path),
  ).toEqual(["states.A.on.0.continue", "states.A.on.1.continue"]);
  expect(issues.every((i) => i.severity === "warn")).toBe(true);
  expect(logicHasErrors(issues, "c")).toBe(false);
});

it("accepts $start as a built-in trigger", () => {
  const d: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "s",
        name: "S",
        kind: "machine",
        states: {
          A: { on: [{ on: "$start", goto: "B" }] },
          B: {},
        },
      },
    ],
  };
  expect(validateLogicDocument(d)).toEqual([]);
});

it("accepts a $logic trigger and rejects an unknown logic", () => {
  const d: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "a",
        name: "a",
        kind: "machine",
        output: { scope: "memory" },
        states: { Idle: {} },
      },
      {
        id: "b",
        name: "b",
        kind: "machine",
        output: { scope: "memory" },
        states: { Idle: { on: [{ on: "$logic.a" }] } },
      },
    ],
  };
  expect(validateLogicDocument(d)).toEqual([]);
  (
    d.logics[1] as never as { states: { Idle: { on: { on: string }[] } } }
  ).states.Idle.on[0].on = "$logic.ghost";
  expect(
    validateLogicDocument(d).some((i) =>
      i.message.includes("unknown logic ghost"),
    ),
  ).toBe(true);
});

it("accepts a global $var trigger", () => {
  const d: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "v",
        name: "v",
        kind: "machine",
        output: { scope: "memory" },
        states: { Idle: { on: [{ on: "$var.Alarm" }] } },
      },
    ],
  };
  expect(validateLogicDocument(d)).toEqual([]);
});
