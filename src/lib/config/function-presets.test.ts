import { describe, expect, it } from "vitest";
import { functionTemplateProblem } from "./functions";
import { BUILTIN_FUNCTIONS } from "./function-presets";

describe("BUILTIN_FUNCTIONS", () => {
  it("are valid and have unique ids", () => {
    const ids = new Set(BUILTIN_FUNCTIONS.map((entry) => entry.id));
    expect(ids.size).toBe(BUILTIN_FUNCTIONS.length);
    for (const entry of BUILTIN_FUNCTIONS) {
      expect(functionTemplateProblem(entry)).toBeNull();
    }
  });
});
