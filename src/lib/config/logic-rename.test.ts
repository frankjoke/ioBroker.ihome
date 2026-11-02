import { it, expect } from "vitest";
import type { LogicDef } from "$logic/types";
import { renameMemoryRefs } from "$lib/config/logic-rename";

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
