import { expect, it } from "vitest";
import { gotoInsertAt, insertAtCaret, insertRange } from "./code-field";

it("inserts at the caret and returns the new caret", () => {
  expect(insertAtCaret("get()", 4, 4, '"x"')).toEqual({
    text: 'get("x")',
    caret: 7,
  });
});

it("replaces the selection", () => {
  expect(insertAtCaret("ab", 0, 2, "xy")).toEqual({ text: "xy", caret: 2 });
});

it("appends at the end and leaves the caret after the insertion", () => {
  expect(insertAtCaret("get()", 5, 5, " !== 0")).toEqual({
    text: "get() !== 0",
    caret: 11,
  });
});

it("maps the goto select index without colliding with state names", () => {
  const states = ["__stay__", "On"];
  expect(gotoInsertAt(0, states)).toBeNull();
  expect(gotoInsertAt(1, states)).toBe("goto()");
  expect(gotoInsertAt(2, states)).toBe('goto("__stay__")');
  expect(gotoInsertAt(3, states)).toBe('goto("On")');
  expect(gotoInsertAt(4, states)).toBeNull();
});

it("inserts at the remembered range only when the field had focus", () => {
  expect(insertRange(true, 2, 4, 10)).toEqual([2, 4]);
  expect(insertRange(false, 2, 4, 10)).toEqual([10, 10]);
});
