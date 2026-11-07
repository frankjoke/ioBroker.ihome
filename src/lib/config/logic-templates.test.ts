import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "$logic/templates";
import { logicTemplateProblem } from "./logic-templates";

const valid = {
  id: "copy",
  name: "Copy",
  params: [{ name: "source", label: "Source", type: "state" }],
  logic: {
    id: "logik",
    name: "Logik",
    kind: "function",
    inputs: {
      source: { from: { type: "state", ref: "{{source}}" }, kind: "event" },
    },
    output: { scope: "memory" },
    expr: { code: 'get("source")' },
  },
};

describe("logicTemplateProblem", () => {
  it("accepts a template whose required params have no defaults", () => {
    expect(logicTemplateProblem(valid, [])).toBeNull();
  });

  it("requires an id, name, params and logic", () => {
    expect(logicTemplateProblem({ ...valid, id: "" }, [])).toMatch(/id/i);
    expect(logicTemplateProblem({ ...valid, name: " " }, [])).toMatch(/name/i);
    expect(logicTemplateProblem({ ...valid, params: 5 }, [])).toMatch(
      /params/i,
    );
    expect(logicTemplateProblem({ ...valid, logic: null }, [])).toMatch(
      /logic/i,
    );
  });

  it("rejects duplicate ids and duplicate/unknown params", () => {
    expect(logicTemplateProblem(valid, ["copy"])).toMatch(/already/);
    expect(logicTemplateProblem(valid, ["copy"], [], "copy")).toBeNull();
    expect(
      logicTemplateProblem(
        {
          ...valid,
          params: [
            { name: "a", label: "A", type: "state" },
            { name: "a", label: "B", type: "state" },
          ],
        },
        [],
      ),
    ).toMatch(/duplicate parameter/i);
    expect(
      logicTemplateProblem(
        {
          ...valid,
          params: [{ name: "a", label: "A", type: "nope" }],
        },
        [],
      ),
    ).toMatch(/known type/i);
  });

  it("rejects broken logic and accepts a $logic reference", () => {
    expect(
      logicTemplateProblem(
        {
          ...valid,
          logic: { ...valid.logic, expr: { code: "1 +" } },
        },
        [],
      ),
    ).toMatch(/expression failed/i);
    expect(
      logicTemplateProblem(
        {
          ...valid,
          logic: {
            ...valid.logic,
            inputs: {
              source: {
                from: { type: "state", ref: "$logic.other" },
                kind: "event",
              },
            },
          },
        },
        [],
        ["other"],
      ),
    ).toBeNull();
  });
});

describe("built-in logic template help", () => {
  it("describes every parameter", () => {
    for (const template of BUILTIN_TEMPLATES) {
      for (const param of template.params) {
        expect(param.description?.trim()).toBeTruthy();
      }
    }
  });
});
