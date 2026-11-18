import { expect, it } from "vitest";
import { toStatementBodies } from "./function-bodies";
import type { LogicDocument } from "./types";

const doc = (mode?: "expression" | "statements"): LogicDocument => ({
  version: 3,
  logics: [
    {
      id: "x",
      name: "X",
      kind: "function",
      ...(mode ? { mode } : {}),
      expr: { code: 'get("v") * 2' },
    },
    {
      id: "m",
      name: "M",
      kind: "machine",
      states: { A: {} },
    },
  ],
});

it("wraps a stored expression as the body's return", () => {
  const input = doc();
  const out = toStatementBodies(input);
  expect(out.logics[0]).toMatchObject({
    mode: "statements",
    expr: { code: 'return (get("v") * 2\n);' },
  });
  // The machine is untouched.
  expect(out.logics[1]).toBe(input.logics[1]);
  // The input document is not mutated.
  expect(input.logics[0].mode).toBeUndefined();
});

it("leaves a body alone and is idempotent", () => {
  const once = toStatementBodies(doc());
  expect(toStatementBodies(once)).toBe(once);

  const body = doc("statements");
  expect(toStatementBodies(body)).toBe(body);
});
