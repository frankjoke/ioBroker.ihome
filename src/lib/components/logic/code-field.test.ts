import { expect, it } from "vitest";
import {
  gotoInsertAt,
  insertAtCaret,
  insertRange,
  toggleComment,
} from "./code-field";

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

it("comments a selection and selects the wrapped text", () => {
  expect(toggleComment("return 1;", 0, 9, true)).toEqual({
    text: "/* return 1; */",
    start: 0,
    end: 15,
  });
});

it("uncomments a selected block", () => {
  expect(toggleComment("/* return 1; */", 0, 15, true)).toEqual({
    text: "return 1;",
    start: 0,
    end: 9,
  });
});

it("keeps surrounding whitespace outside the markers", () => {
  expect(toggleComment("  /* x */  ", 0, 11, true)).toEqual({
    text: "  x  ",
    start: 0,
    end: 5,
  });
});

it("inserts an empty comment at the caret", () => {
  expect(toggleComment("a", 1, 1, true)).toEqual({
    text: "a/*  */",
    start: 4,
    end: 4,
  });
});

it("appends the comment when the field was not focused", () => {
  expect(toggleComment("a", 0, 0, false)).toEqual({
    text: "a/*  */",
    start: 4,
    end: 4,
  });
});
