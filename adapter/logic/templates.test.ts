import { expect, it } from "vitest";
import { BUILTIN_TEMPLATES, instantiateTemplate } from "./templates";
import { validateLogicDocument } from "./validate";

it("ships three templates", () => {
  expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
    "light-switch-off-delay",
    "light-motion-off-delay",
    "computed-value",
  ]);
});

it("substitutes parameters into a valid logic", () => {
  const template = BUILTIN_TEMPLATES.find(
    (entry) => entry.id === "light-motion-off-delay",
  )!;
  const logic = instantiateTemplate(
    template,
    { motion: "0_userdata.0.M", light: "0_userdata.0.L", delay: "2m" },
    "hallway",
  );
  expect(JSON.stringify(logic)).not.toContain("{{");
  expect(logic.id).toBe("hallway");
  // The light is the logic's output; the motion state only triggers it.
  expect(logic.output).toEqual({
    scope: "state",
    ref: "0_userdata.0.L",
    type: "boolean",
    on: "On*",
  });
  expect(validateLogicDocument({ version: 2, logics: [logic] })).toEqual([]);
});

it("keeps typed parameters typed", () => {
  const template = BUILTIN_TEMPLATES.find(
    (entry) => entry.id === "computed-value",
  )!;
  const logic = instantiateTemplate(
    template,
    {
      source: "0_userdata.0.T",
      target: "0_userdata.0.OUT",
      factor: 2.5,
    },
    "calc",
  );
  expect((logic as { expr?: unknown }).expr).toEqual({
    code: 'get("value") * 2.5',
  });
  expect(validateLogicDocument({ version: 2, logics: [logic] })).toEqual([]);
});

it("refuses a missing parameter", () => {
  const template = BUILTIN_TEMPLATES.find(
    (entry) => entry.id === "light-motion-off-delay",
  )!;
  expect(() =>
    instantiateTemplate(template, { motion: "0_userdata.0.M" }, "x"),
  ).toThrow();
});
