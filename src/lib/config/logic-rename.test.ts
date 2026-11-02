import { it, expect } from "vitest";
import type { LogicDef } from "$logic/types";
import { renameLogicRefs, renameMemoryRefs } from "$lib/config/logic-rename";

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
    expr: { ref: "old" },
  } as LogicDef;

  const next = renameMemoryRefs(logic, "old", "new");
  expect(next.inputs?.m.from).toEqual({ type: "memory", ref: "new" });
  expect(next.inputs?.s.from).toEqual({ type: "state", ref: "old.state" });
  expect((next as { expr?: unknown }).expr).toEqual({ ref: "new" });
  expect(next.output).toEqual({ scope: "memory", name: "out" });
  // The source document is untouched.
  expect(logic.inputs?.m.from).toEqual({ type: "memory", ref: "old" });
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
