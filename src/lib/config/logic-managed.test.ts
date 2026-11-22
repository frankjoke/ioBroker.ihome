import { expect, it } from "vitest";
import { keepManaged } from "./logic-managed";

it("keeps the managed marker through an edit", () => {
  const previous = {
    id: "a",
    name: "A",
    kind: "function" as const,
    expr: { code: "1" },
    managed: { plugin: "col.test", version: "1.0.0", baseline: "a".repeat(64) },
  };
  const next = { ...previous, name: "Renamed" };
  delete (next as { managed?: unknown }).managed;
  expect(keepManaged(next, previous).managed).toEqual(previous.managed);
});

it("does not invent a marker on an unmanaged logic", () => {
  const next = { id: "b", name: "B", managed: undefined };
  expect(
    keepManaged(next, { id: "b", name: "Old", managed: undefined }),
  ).toEqual(next);
});
