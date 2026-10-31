import { expect, it } from "vitest";
import { evaluate } from "./expr";
import type { Expr } from "./types";

const refs: Record<string, unknown> = { a: 4, b: 2, on: true, text: "hey" };
const resolve = (ref: string) => refs[ref];

it("evaluates arithmetic and comparisons", () => {
  expect(
    evaluate({ op: "add", left: { ref: "a" }, right: { const: 1 } }, resolve),
  ).toBe(5);
  expect(
    evaluate({ op: "div", left: { ref: "a" }, right: { ref: "b" } }, resolve),
  ).toBe(2);
  expect(
    evaluate({ op: "gt", left: { ref: "a" }, right: { const: 3 } }, resolve),
  ).toBe(true);
  expect(
    evaluate(
      { op: "eq", left: { ref: "text" }, right: { const: "hey" } },
      resolve,
    ),
  ).toBe(true);
});

it("evaluates boolean and helper ops", () => {
  expect(
    evaluate({ op: "and", of: [{ ref: "on" }, { const: 1 }] }, resolve),
  ).toBe(true);
  expect(evaluate({ op: "not", of: { const: 0 } }, resolve)).toBe(true);
  expect(evaluate({ op: "round", of: { const: 1.56 } }, resolve)).toBe(2);
  expect(
    evaluate({ op: "clamp", of: { const: 12 }, min: 0, max: 10 }, resolve),
  ).toBe(10);
  expect(
    evaluate({ op: "min", of: [{ const: 3 }, { const: 7 }] }, resolve),
  ).toBe(3);
  expect(evaluate({ op: "len", of: { ref: "text" } }, resolve)).toBe(3);
  expect(
    evaluate(
      {
        op: "if",
        cond: { ref: "on" },
        then: { const: "yes" },
        else: { const: "no" },
      },
      resolve,
    ),
  ).toBe("yes");
});

it("throws on invalid input instead of guessing", () => {
  const divZero: Expr = { op: "div", left: { const: 1 }, right: { const: 0 } };
  expect(() => evaluate(divZero, resolve)).toThrow();
  expect(() =>
    evaluate({ op: "add", left: { const: 1 }, right: { const: "x" } }, resolve),
  ).toThrow();
  expect(() => evaluate({ op: "nope" } as never, resolve)).toThrow();
});
