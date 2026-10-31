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
  expect(
    issues.some((i) => i.logicId === "counter" && i.path === "output.map"),
  ).toBe(true);
  expect(logicHasErrors(issues, "counter")).toBe(true);
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
          state: { op: "if", cond: { ref: "p" }, then: { const: "A" }, else: { const: "B" } },
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
