import { describe, expect, it } from "vitest";
import { BUILTIN_FUNCTIONS } from "./function-presets";
import { codeTemplateChoices, snippetChoices } from "./snippets";

describe("codeTemplateChoices", () => {
  it("adds saved formulas to expression choices, never to statements", () => {
    const formulas = [
      { id: "f1", name: "Dew point", expr: "$.a + $.b" },
      { id: "f2", name: "Empty", expr: "  " },
    ];
    const expr = codeTemplateChoices([], formulas, "expression");
    expect(expr.some((entry) => entry.id === "formula:f1")).toBe(true);
    expect(expr.some((entry) => entry.id === "formula:f2")).toBe(false);
    expect(
      codeTemplateChoices([], formulas, "statements").some((entry) =>
        entry.id.startsWith("formula:"),
      ),
    ).toBe(false);
  });
});

describe("snippetChoices", () => {
  it("filters by mode and puts built-ins first", () => {
    const user = [
      {
        id: "u-expr",
        name: "U expr",
        mode: "expression" as const,
        code: "1 + 1",
      },
      {
        id: "u-stmt",
        name: "U stmt",
        mode: "statements" as const,
        code: 'set("x", 1)',
      },
    ];
    expect(
      snippetChoices(user, "expression").every(
        (entry) => entry.mode === "expression",
      ),
    ).toBe(true);
    expect(snippetChoices(user, "statements").map((entry) => entry.id)).toEqual(
      [
        ...BUILTIN_FUNCTIONS.filter((entry) => entry.mode === "statements").map(
          (entry) => entry.id,
        ),
        "u-stmt",
      ],
    );
    expect(snippetChoices(user, "both")).toHaveLength(
      BUILTIN_FUNCTIONS.length + 2,
    );
    expect(snippetChoices(user, "both")[0].id).toBe(BUILTIN_FUNCTIONS[0].id);
  });

  it("offers the side-effect snippets to action expressions", () => {
    const ids = snippetChoices([], "expression").map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "log-expr",
        "message-expr",
        "push-private-expr",
        "push-visible-expr",
      ]),
    );
  });
});
