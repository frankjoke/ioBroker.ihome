import { describe, expect, it } from "vitest";
import {
  buildDeviceLogic,
  templateStateSpecs,
  validateDeviceTemplate,
} from "./device-templates";
import { validateLogicDocument } from "./validate";
import type { DeviceTemplateShape } from "./types";

const SOURCE = `({
  params: [
    { name: "baseUrl", label: "Base URL", type: "string" },
    { name: "token", label: "Token", type: "state" },
    { name: "poll", label: "Poll", type: "duration", default: "30s" },
  ],
  itemList: [
    { name: "power", type: "boolean", role: "switch", source: "data.power",
      foreignWriteName: "power", conversion: (r, raw) => raw === "1",
      setConversion: (v) => (v ? "1" : "0") },
    { name: "level", type: "number", role: "level", unit: "%",
      states: '{"0":"Off","100":"Full"}', source: "data.level",
      foreignWriteName: "level", readOnly: false },
    { name: "config", type: "object", source: "data.config", readOnly: true },
  ],
  readRequest(p) { return { url: p.baseUrl + "/status", options: { headers: { authorization: "Bearer " + p.token } } }; },
  writeRequest(v, item, p) { return { url: p.baseUrl + "/set?" + item.foreignWriteName + "=" + item.setConversion(v) }; },
})`;

const template = new Function(
  "return (" + SOURCE + ")",
)() as DeviceTemplateShape;

describe("validateDeviceTemplate", () => {
  it("accepts a valid template", () => {
    expect(validateDeviceTemplate(template).errors).toEqual([]);
  });

  it("rejects duplicate, reserved or invalid item names", () => {
    expect(
      validateDeviceTemplate({
        ...template,
        itemList: [template.itemList[0], template.itemList[0]],
      }).errors,
    ).toContain("duplicate item name: power");
    expect(
      validateDeviceTemplate({
        ...template,
        itemList: [{ ...template.itemList[0], name: "$init" }],
      }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateDeviceTemplate({
        ...template,
        itemList: [{ ...template.itemList[0], name: "bad name" }],
      }).errors.length,
    ).toBeGreaterThan(0);
  });

  it("rejects a writable item without a write name and ack false", () => {
    const item = { ...template.itemList[0], foreignWriteName: undefined };
    expect(
      validateDeviceTemplate({ ...template, itemList: [item] }).errors,
    ).toContain("power needs foreignWriteName");
    const loop = { ...template.itemList[0], ack: false };
    expect(
      validateDeviceTemplate({ ...template, itemList: [loop] }).errors,
    ).toContain("power: ack false on a writable item would loop");
  });

  it("rejects invalid states JSON", () => {
    const item = { ...template.itemList[1], states: "{" };
    expect(
      validateDeviceTemplate({ ...template, itemList: [item] }).errors.length,
    ).toBeGreaterThan(0);
  });
});

describe("templateStateSpecs", () => {
  it("builds state specs with types, labels, limits and readOnly", () => {
    const specs = templateStateSpecs(template, "ihome.0.Variables.Garten");
    expect(specs[0]).toMatchObject({
      id: "ihome.0.Variables.Garten.power",
      common: { type: "boolean", role: "switch", write: true, def: false },
    });
    expect(specs[1]).toMatchObject({
      common: {
        type: "number",
        role: "level",
        unit: "%",
        states: { "0": "Off", "100": "Full" },
        def: 0,
      },
    });
    expect(specs[2]).toMatchObject({
      common: {
        type: "string",
        role: "json",
        write: false,
        states: {},
        def: "{}",
      },
    });
  });
});

describe("buildDeviceLogic", () => {
  it("builds a machine that validates and uses fetchJson", () => {
    const logic = buildDeviceLogic(
      template,
      SOURCE,
      {
        baseUrl: "https://x",
        token: "0_userdata.0.Token",
        poll: "30s",
      },
      "ihome.0.Variables.Garten",
      "garden",
      "Garden",
    );
    expect(logic.kind).toBe("machine");
    expect(logic.output).toEqual({ scope: "memory", name: "garden" });
    expect(logic.inputs?.poll).toEqual({
      from: { type: "timer", every: "30s" },
      kind: "event",
    });
    expect(logic.inputs?.power).toMatchObject({
      kind: "event",
      from: { type: "state", ref: "ihome.0.Variables.Garten.power" },
    });
    const rows = logic.states.Run.on!;
    expect(rows[0].on).toBe("poll");
    expect(rows[0].do?.code).toContain("fetchJson");
    expect(rows[0].do?.code).toContain('P.token = get("0_userdata.0.Token")');
    expect(rows[0].do?.code).toContain("item.ack ?? true");
    expect(rows[0].do?.code).toContain("JSON.stringify");
    const powerRow = rows.find((row) => row.on === "power")!;
    expect(powerRow.ack).toBe("false");
    expect(powerRow.edge).toBe("change");
    expect(rows.some((row) => row.on === "config")).toBe(false);
    expect(
      validateLogicDocument({ version: 3, logics: [logic] }).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
  });

  it("uses edge any for updateAlways", () => {
    const t = {
      ...template,
      itemList: [{ ...template.itemList[0], updateAlways: true }],
    };
    const logic = buildDeviceLogic(
      t,
      SOURCE,
      {},
      "ihome.0.Variables.Garten",
      "garden",
      "Garden",
    );
    expect(logic.states.Run.on!.find((row) => row.on === "power")!.edge).toBe(
      "any",
    );
  });
});

it("rejects async request or conversion functions", () => {
  expect(
    validateDeviceTemplate({
      ...template,
      readRequest: async () => ({ url: "https://x" }),
    }).errors,
  ).toContain("readRequest must be synchronous");
  expect(
    validateDeviceTemplate({
      ...template,
      itemList: [
        {
          ...template.itemList[0],
          conversion: async (_result, raw) => raw,
        },
      ],
    }).errors,
  ).toContain("power: conversion must be synchronous");
});
