import { it, expect } from "vitest";
import type { LogicDef } from "$logic/types";
import {
  renameLogicRefs,
  renameMemoryRefs,
  renameStateRefs,
} from "$lib/config/logic-rename";

it("rewrites bare memory refs, not states or the output name", () => {
  const logic = {
    id: "reader",
    name: "reader",
    kind: "function",
    inputs: {
      m: { from: { type: "memory", ref: "old" }, kind: "variable" },
      s: { from: { type: "state", ref: "old.state" }, kind: "event" },
    },
    output: { scope: "memory", name: "out" },
    expr: { code: 'get("old") + 1' },
  } as LogicDef;

  const next = renameMemoryRefs(logic, "old", "new");
  expect(next.inputs?.m.from).toEqual({ type: "memory", ref: "new" });
  expect(next.inputs?.s.from).toEqual({ type: "state", ref: "old.state" });
  expect((next as { expr?: unknown }).expr).toEqual({
    code: 'get("new") + 1',
  });
  expect(next.output).toEqual({ scope: "memory", name: "out" });
  // The source document is untouched.
  expect(logic.inputs?.m.from).toEqual({ type: "memory", ref: "old" });
});

it("rewrites state names inside code calls", () => {
  const logic = {
    id: "writer",
    name: "writer",
    kind: "function",
    expr: { code: 'state("old").set(1)' },
  } as LogicDef;
  expect(
    (renameMemoryRefs(logic, "old", "new") as { expr: unknown }).expr,
  ).toEqual({ code: 'state("new").set(1)' });

  const plain = {
    ...logic,
    expr: { code: 'set("old", 1)' },
  } as LogicDef;
  expect(
    (renameMemoryRefs(plain, "old", "new") as { expr: unknown }).expr,
  ).toEqual({ code: 'set("new", 1)' });
});

it("rewrites $logic triggers, and only the renamed one", () => {
  const logic = {
    id: "sink",
    name: "sink",
    kind: "machine",
    states: {
      A: { on: [{ on: "$logic.old" }, { on: "$logic.other" }] },
    },
  } as LogicDef;
  const next = renameLogicRefs(logic, "old", "new");
  const rows = (next as unknown as { states: { A: { on: { on: string }[] } } })
    .states.A.on;
  expect(rows[0].on).toBe("$logic.new");
  expect(rows[1].on).toBe("$logic.other");
});

it("rewrites state references in code and structured fields", () => {
  const logic = {
    id: "m",
    name: "M",
    kind: "machine",
    start: "old",
    init: { state: "old" },
    states: {
      old: {
        after: { time: "1m", goto: "old" },
        on: [
          {
            on: "e",
            mode: "function",
            do: { code: 'goto("old")\nif (get("x")) goto("old")' },
          },
          { on: "e", goto: "old" },
        ],
      },
    },
  } as const;
  const next = renameStateRefs(logic as never, "old", "new") as any;
  expect(next.start).toBe("new");
  expect(next.init.state).toBe("new");
  expect(next.states.old.after.goto).toBe("new");
  expect(next.states.old.on[0].do.code).toBe(
    'goto("new")\nif (get("x")) goto("new")',
  );
  expect(next.states.old.on[1].goto).toBe("new");
});

it("rewrites memory refs inside statement code", () => {
  const logic = {
    id: "m",
    name: "M",
    kind: "machine",
    states: {
      A: {
        on: [
          {
            on: "e",
            mode: "function",
            do: { code: 'set("old", 1)\nget("old")' },
          },
        ],
      },
    },
  } as const;
  const next = renameMemoryRefs(logic as never, "old", "new") as any;
  expect(next.states.A.on[0].do.code).toBe('set("new", 1)\nget("new")');
});
