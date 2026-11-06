import { expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const objects = new Map<string, any>();
  const ioBroker = {
    namespace: "ihome.0",
    connected: true,
    objects: {
      get: (id: string) => objects.get(id),
      update: (id: string, object: any) => objects.set(id, object),
    },
    emitAsync: async (event: string, ...args: any[]) => {
      if (event === "getObject") return objects.get(args[0]);
      if (event === "setObject") objects.set(args[0], args[1]);
      return undefined;
    },
    setState: async () => {},
  };
  return { objects, ioBroker };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: mock.ioBroker }));

import { validateLogicDocument } from "$logic/validate";
import {
  createTemplateStates,
  planDeviceTemplate,
} from "./device-template-apply";

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

it("rejects a base state outside the adapter namespace", async () => {
  await expect(createTemplateStates([], "0_userdata.0.X")).rejects.toThrow(
    "base state must start with ihome.0.",
  );
});

it("rejects a reserved base folder", async () => {
  await expect(
    createTemplateStates([], "ihome.0.Logic.Device"),
  ).rejects.toThrow("base state may not use the Logic folder");
});

it("aborts when a foreign state would be overwritten", async () => {
  mock.objects.set("0_userdata.0.X", {
    _id: "0_userdata.0.X",
    type: "state",
    common: { type: "string" },
  });
  await expect(
    createTemplateStates(
      [{ id: "0_userdata.0.X", common: { type: "string" } }],
      "ihome.0.Variables.Garten",
    ),
  ).rejects.toThrow("existing foreign states were not overwritten");
});
