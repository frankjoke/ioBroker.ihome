import { expect, it } from "vitest";
import { compileDerivedFunction } from "$adapter/history-derived-runtime";
import {
  DEFAULT_DERIVED_FUNCTION,
  DERIVED_FUNCTION_EXAMPLES,
} from "./history-derived-examples";

it("ships runnable derived function examples", () => {
  const context = {
    samples: [
      { ts: 1_000, val: 10 },
      { ts: 2_000, val: 20 },
    ],
    previous: { ts: 0, val: 5 },
    from: 0,
    to: 3_000,
  };
  const expected: Record<string, number> = {
    average: 15,
    "time-weighted-average": 35_000 / 3_000,
    median: 15,
    minimum: 10,
    maximum: 20,
    sum: 30,
  };
  expect(new Set(DERIVED_FUNCTION_EXAMPLES.map((entry) => entry.id)).size).toBe(
    DERIVED_FUNCTION_EXAMPLES.length,
  );
  for (const example of DERIVED_FUNCTION_EXAMPLES) {
    expect(
      compileDerivedFunction(example.code)(context),
      example.name,
    ).toBeCloseTo(expected[example.id]);
  }
  expect(DEFAULT_DERIVED_FUNCTION).toBe(DERIVED_FUNCTION_EXAMPLES[0].code);
});
