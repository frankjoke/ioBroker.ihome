import { describe, expect, it } from "vitest";
import { visualTemplateProblem } from "./visual-templates";

const valid = {
  id: "custom-light",
  name: "Custom light",
  type: "Light",
  features: [],
  slots: [{ kind: "value", source: "power" }],
  size: { w: 1, h: 1 },
};

describe("visualTemplateProblem", () => {
  it("accepts a minimal valid template", () => {
    expect(visualTemplateProblem(valid, [])).toBeNull();
  });

  it("requires an id, name, type and known type", () => {
    expect(visualTemplateProblem({ ...valid, id: "" }, [])).toMatch(/id/i);
    expect(visualTemplateProblem({ ...valid, name: " " }, [])).toMatch(/name/i);
    expect(visualTemplateProblem({ ...valid, type: "" }, [])).toMatch(/type/i);
    expect(visualTemplateProblem({ ...valid, type: "Nope" }, [])).toMatch(
      /unknown/i,
    );
  });

  it("rejects duplicate ids unless it is the current template", () => {
    expect(visualTemplateProblem(valid, ["custom-light"])).toMatch(/already/);
    expect(
      visualTemplateProblem(valid, ["custom-light"], "custom-light"),
    ).toBeNull();
  });

  it("rejects non-array slots/features and malformed slots", () => {
    expect(visualTemplateProblem({ ...valid, slots: 5 }, [])).toMatch(/slots/i);
    expect(visualTemplateProblem({ ...valid, features: 5 }, [])).toMatch(
      /features/i,
    );
    expect(
      visualTemplateProblem({ ...valid, slots: [{ source: "x" }] }, []),
    ).toMatch(/kind/i);
    expect(
      visualTemplateProblem(
        { ...valid, slots: [{ kind: "value", rules: 5 }] },
        [],
      ),
    ).toMatch(/rules/i);
  });

  it("rejects a malformed size", () => {
    expect(
      visualTemplateProblem({ ...valid, size: { w: 0, h: 1 } }, []),
    ).toMatch(/size/i);
  });

  it("accepts the doubled size limits", () => {
    expect(
      visualTemplateProblem({ ...valid, size: { w: 40, h: 20 } }, []),
    ).toBeNull();
    expect(
      visualTemplateProblem({ ...valid, size: { w: 41, h: 21 } }, []),
    ).toMatch(/size/i);
  });
});
