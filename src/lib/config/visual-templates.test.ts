import { expect, it } from "vitest";
import { visualTemplateProblem } from "./visual-templates";
import { PRESETS } from "./template-ops";
import type { FeatureDef } from "./features";

function feature(overrides: Partial<FeatureDef> = {}): FeatureDef {
  return {
    feature: "power",
    label: "Power",
    widget: "switch",
    roleHints: [],
    ...overrides,
  };
}

it("rejects duplicate feature keys", () => {
  expect(
    visualTemplateProblem(
      {
        ...PRESETS.Light,
        features: [
          feature(),
          feature({ label: "Power 2" }),
        ],
      },
      [],
    ),
  ).toContain("Duplicate");
});

it("rejects more than one primary", () => {
  expect(
    visualTemplateProblem(
      {
        ...PRESETS.Light,
        features: [
          feature({ feature: "a", label: "A", primary: true }),
          feature({ feature: "b", label: "B", primary: true }),
        ],
      },
      [],
    ),
  ).toContain("primary");
});

it("accepts active and look", () => {
  expect(
    visualTemplateProblem(
      {
        ...PRESETS.Light,
        active: { source: "power", op: "truthy" },
        look: { inactive: { glyph: "x" } },
      },
      [],
    ),
  ).toBeNull();
});

it("rejects malformed features and active conditions", () => {
  expect(
    visualTemplateProblem(
      { ...PRESETS.Light, features: [{ feature: "", label: "", roleHints: [] }] },
      [],
    ),
  ).not.toBeNull();
  expect(
    visualTemplateProblem(
      {
        ...PRESETS.Light,
        active: { source: "power", op: "nope" as never },
      },
      [],
    ),
  ).not.toBeNull();
});
