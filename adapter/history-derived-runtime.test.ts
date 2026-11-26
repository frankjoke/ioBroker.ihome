import { expect, it } from "vitest";
import {
  NOOP,
  compileDerivedFunction,
  mean,
  median,
  min,
  max,
  sum,
  timeWeightedMean,
} from "./history-derived-runtime";

it("computes the numeric helpers", () => {
  expect(mean([1, 2, 3])).toBe(2);
  expect(mean([])).toBeNaN();
  expect(sum([1, 2, 3])).toBe(6);
  expect(sum([])).toBeNaN();
  expect(min([3, 1, 2])).toBe(1);
  expect(max([3, 1, 2])).toBe(3);
  expect(median([1, 3, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
  expect(median([])).toBeNaN();
});

it("computes a time-weighted mean with the previous value", () => {
  const samples = [
    { ts: 1000, val: 10 },
    { ts: 2000, val: 20 },
  ];
  expect(timeWeightedMean(samples, 0, 3000, { ts: -1000, val: 0 })).toBeCloseTo(
    10,
  );
  expect(timeWeightedMean(samples, 0, 3000, null)).toBeCloseTo(15);
  expect(timeWeightedMean([], 0, 3000, { ts: 0, val: 7 })).toBe(7);
});

it("runs a function in a fresh sandbox", () => {
  const run = compileDerivedFunction(
    "globalThis.n = (globalThis.n ?? 0) + 1; return globalThis.n;",
  );
  expect(run({ samples: [], previous: null, from: 0, to: 1 })).toBe(1);
  expect(run({ samples: [], previous: null, from: 0, to: 1 })).toBe(1);
});

it("exposes helpers and hides broker/network helpers", () => {
  const run = compileDerivedFunction(
    "return mean(samples.map(s => s.val)) + (typeof get === 'undefined' ? 0 : 100) + (typeof console === 'undefined' ? 0 : 100);",
  );
  expect(
    run({
      samples: [
        { ts: 0, val: 2 },
        { ts: 1, val: 4 },
      ],
      previous: null,
      from: 0,
      to: 2,
    }),
  ).toBe(3);
});

it("returns NOOP and rejects invalid results", () => {
  expect(
    compileDerivedFunction("return NOOP;")({
      samples: [],
      previous: null,
      from: 0,
      to: 1,
    }),
  ).toBe(NOOP);
  for (const code of ["return;", "const unused = 1;"]) {
    expect(
      compileDerivedFunction(code)({
        samples: [],
        previous: null,
        from: 0,
        to: 1,
      }),
    ).toBe(NOOP);
  }
  for (const code of [
    "return 'x';",
    "return NaN;",
    "return {};",
    "throw new Error('boom');",
  ]) {
    expect(() =>
      compileDerivedFunction(code)({
        samples: [],
        previous: null,
        from: 0,
        to: 1,
      }),
    ).toThrow();
  }
  expect(() => compileDerivedFunction("return (")).toThrow("compile");
});
