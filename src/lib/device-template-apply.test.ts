import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    objects: { get: () => undefined, update: () => {} },
    getObject: async () => null,
    emitAsync: async () => {},
  },
}));

import { validateLogicDocument } from "$logic/validate";
import { planDeviceTemplate } from "./device-template-apply";

const SOURCE = `({
  itemList: [{ name: "power", type: "boolean", source: "data.power", foreignWriteName: "power" }],
  readRequest() { return { url: "https://x/status" }; },
  writeRequest(v, item) { return { url: "https://x/set?" + item.foreignWriteName + "=" + v }; },
})`;

it("plans states and a valid machine", () => {
  const template = new Function("return (" + SOURCE + ")")();
  const plan = planDeviceTemplate(
    template,
    SOURCE,
    {},
    "ihome.0.Variables.Garten",
    "garden",
    "Garden",
  );
  expect(plan.specs[0].id).toBe("ihome.0.Variables.Garten.power");
  expect(plan.logic.id).toBe("garden");
  expect(
    validateLogicDocument({ version: 3, logics: [plan.logic] }).filter(
      (issue) => issue.severity === "error",
    ),
  ).toEqual([]);
});

it("rejects an invalid template before planning", () => {
  const template = new Function("return (" + SOURCE + ")")();
  const bad = { ...template, itemList: [] };
  expect(() =>
    planDeviceTemplate(
      bad,
      SOURCE,
      {},
      "ihome.0.Variables.Garten",
      "garden",
      "Garden",
    ),
  ).toThrow();
});
