import { expect, it } from "vitest";
import { insertAtCaret } from "./code-field";

it("inserts at the caret and returns the new caret", () => {
  expect(insertAtCaret("get()", 4, 4, '"x"')).toEqual({
    text: 'get("x")',
    caret: 7,
  });
});

it("replaces the selection", () => {
  expect(insertAtCaret("ab", 0, 2, "xy")).toEqual({ text: "xy", caret: 2 });
});
