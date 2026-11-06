import { describe, expect, it } from "vitest";
import {
  functionTemplateProblem,
  migrateFunctionLibrary,
} from "./functions";

const template = (
  over: Partial<Parameters<typeof functionTemplateProblem>[0]> = {},
) => ({
  id: "t",
  name: "Snippet",
  mode: "expression" as const,
  code: "1 + 1",
  ...over,
});

describe("migrateFunctionLibrary", () => {
  it("reads an object, a JSON string and a state value", () => {
    const lib = { version: 1, updatedAt: 2, functions: [template()] };
    expect(migrateFunctionLibrary(lib).functions).toHaveLength(1);
    expect(migrateFunctionLibrary(JSON.stringify(lib)).functions).toHaveLength(
      1,
    );
    expect(migrateFunctionLibrary({ val: lib }).functions).toHaveLength(1);
  });

  it("drops invalid entries and never throws", () => {
    expect(
      migrateFunctionLibrary({
        functions: [template(), { id: "x" }, null, { code: "1" }],
      }).functions,
    ).toHaveLength(1);
    expect(migrateFunctionLibrary("nope").functions).toEqual([]);
    expect(migrateFunctionLibrary(null).functions).toEqual([]);
  });
});

describe("functionTemplateProblem", () => {
  it("accepts a valid expression and a valid statement", () => {
    expect(functionTemplateProblem(template())).toBeNull();
    expect(
      functionTemplateProblem(
        template({ mode: "statements", code: 'set("x", 1)' }),
      ),
    ).toBeNull();
  });

  it("rejects empty name, empty code and broken code", () => {
    expect(functionTemplateProblem(template({ name: " " }))).toMatch(/name/i);
    expect(functionTemplateProblem(template({ code: " " }))).toMatch(/empty/i);
    expect(functionTemplateProblem(template({ code: "1 +" }))).toMatch(
      /expression failed/i,
    );
    expect(
      functionTemplateProblem(template({ mode: "statements", code: "if (" })),
    ).toMatch(/action code failed/i);
  });
});
