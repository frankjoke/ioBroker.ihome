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
  isGeneratedForBase,
  planDeviceTemplate,
} from "./device-template-apply";
import type { LogicDef } from "$logic/types";

const SOURCE = `({
  itemList: [{ name: "power", type: "boolean", source: "data.power", foreignWriteName: "power" }],
  readRequest() { return { url: "https://x/status" }; },
  writeRequest(v, item) { return { url: "https://x/set?" + item.foreignWriteName + "=" + v }; },
})`;

it("recognises a template-generated machine for a base state", () => {
  const machine = (code: string) =>
    ({
      id: "meter",
      name: "Meter",
      kind: "machine",
      states: { Run: { on: [{ on: "poll", do: { code } }] } },
    }) as LogicDef;
  // An HTTP template's header is JSON, without a space after the colon.
  const http = machine(
    'const T = ({});\nconst P = {"baseState":"ihome.0.Devices.PowerMeter","baseUrl":"http://x"};',
  );
  expect(isGeneratedForBase(http, "ihome.0.Devices.PowerMeter")).toBe(true);
  // A state template's header is a literal object.
  const state = machine(
    'const T = ({});\nconst P = { baseState: "ihome.0.Devices.PowerMeter" };',
  );
  expect(isGeneratedForBase(state, "ihome.0.Devices.PowerMeter")).toBe(true);
  expect(isGeneratedForBase(http, "ihome.0.Other")).toBe(false);
  expect(
    isGeneratedForBase(
      { ...http, kind: "function" } as never,
      "ihome.0.Devices.PowerMeter",
    ),
  ).toBe(false);
});

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

const DEVICE_SOURCE = `({
  deviceType: "Meter",
  itemList: [
    { name: "power", type: "number", role: "value.power", unit: "W",
      source: "power", readOnly: true },
    { name: "energy", type: "number", role: "value.energy", unit: "kWh",
      source: "energy", readOnly: true },
    { name: "timestamp", type: "string", role: "text",
      source: "timestamp", readOnly: true, hidden: true },
  ],
  readRequest() { return { url: "https://x/status" }; },
  writeRequest() { return { url: "https://x/set" }; },
})`;

it("plans a device with controls when a device name is given", () => {
  const template = new Function("return (" + DEVICE_SOURCE + ")")();
  const plan = planDeviceTemplate(
    template,
    DEVICE_SOURCE,
    {},
    "ihome.0.Variables.Meter",
    "meter",
    "Meter",
    "My Meter",
  );
  expect(plan.device).toMatchObject({
    id: expect.any(String),
    name: "My Meter",
    type: "Meter",
  });
  const kept = planDeviceTemplate(
    template,
    DEVICE_SOURCE,
    {},
    "ihome.0.Variables.Meter",
    "meter",
    "Meter",
    "My Meter",
    "existing-id",
  );
  expect(kept.device?.id).toBe("existing-id");
  expect(plan.device?.controls).toHaveLength(3);
  expect(plan.device?.controls[0]).toMatchObject({
    id: "power",
    feature: "power",
    stateId: "ihome.0.Variables.Meter.power",
    writable: false,
    label: "power",
    unit: "W",
    role: "value.power",
    type: "number",
  });
  expect(plan.device?.controls[1]).toMatchObject({
    feature: "energy",
    stateId: "ihome.0.Variables.Meter.energy",
  });
  expect(plan.device?.controls[2]).toMatchObject({
    feature: "value",
    hidden: true,
  });
});

it("does not create a device for an empty device name", () => {
  const template = new Function("return (" + DEVICE_SOURCE + ")")();
  const plan = planDeviceTemplate(
    template,
    DEVICE_SOURCE,
    {},
    "ihome.0.Variables.Meter",
    "meter",
    "Meter",
    "   ",
  );
  expect(plan.device).toBeUndefined();
});

it("falls back to Custom for an unknown device type", () => {
  const template = new Function("return (" + DEVICE_SOURCE + ")")();
  const plan = planDeviceTemplate(
    { ...template, deviceType: "NoSuchType" },
    DEVICE_SOURCE,
    {},
    "ihome.0.Variables.Meter",
    "meter",
    "Meter",
    "My Meter",
  );
  expect(plan.device?.type).toBe("Custom");
});
