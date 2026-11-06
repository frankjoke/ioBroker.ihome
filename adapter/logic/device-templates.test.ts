import { describe, expect, it } from "vitest";
import {
  buildDeviceLogic,
  pickPath,
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

const MQTT_PAYLOAD = `{
  "timestamp": "2026-11-06T20:44:30",
  "1.8.0": "21557698",
  "2.8.0": "10956548",
  "1.7.0": "388",
  "2.7.0": "0",
  "32.7.0": "230.90",
  "uptime": "0000:03:17:29"
}`;

describe("pickPath", () => {
  it("splits a string path on dots", () => {
    expect(pickPath({ data: { power: true } }, "data.power")).toBe(true);
  });

  it("uses array segments literally, so dotted keys work", () => {
    const payload = JSON.parse(MQTT_PAYLOAD);
    expect(pickPath(payload, ["1.8.0"])).toBe("21557698");
    expect(pickPath(payload, ["32.7.0"])).toBe("230.90");
    expect(pickPath(payload, "1.8.0")).toBeUndefined();
  });

  it("supports nested array segments", () => {
    expect(pickPath({ data: { "1.8.0": 7 } }, ["data", "1.8.0"])).toBe(7);
  });
});

const STATE_SOURCE = `({
  readFrom: "state",
  params: [{ name: "source", label: "Source state", type: "state" }],
  itemList: [
    { name: "energy", label: "Energy", type: "number", role: "value.energy",
      unit: "kWh", source: ["1.8.0"], readOnly: true },
    { name: "power", label: "Power", type: "number", role: "value.power",
      unit: "W", source: ["1.7.0"], readOnly: true },
  ],
})`;
const stateTemplate = new Function(
  "return (" + STATE_SOURCE + ")",
)() as DeviceTemplateShape;

describe("state source templates", () => {
  it("validates a read-only state template", () => {
    expect(validateDeviceTemplate(stateTemplate).errors).toEqual([]);
  });

  it("requires a source state param", () => {
    expect(
      validateDeviceTemplate({ ...stateTemplate, params: [] }).errors,
    ).toContain("state template needs a source param");
  });

  it("rejects writable items in a state template", () => {
    expect(
      validateDeviceTemplate({
        ...stateTemplate,
        itemList: [
          {
            ...stateTemplate.itemList[0],
            readOnly: false,
            foreignWriteName: "energy",
          },
        ],
      }).errors,
    ).toContain("energy: state templates are read-only");
  });

  it("builds a machine that listens to the state and parses JSON", () => {
    const logic = buildDeviceLogic(
      stateTemplate,
      STATE_SOURCE,
      { source: "mqtt.0.SHRDZM.3C6105FB24B9.3C6105FB24B9.sensor" },
      "ihome.0.Variables.Meter",
      "meter",
      "Meter",
    );
    expect(logic.inputs).toEqual({
      source: {
        from: {
          type: "state",
          ref: "mqtt.0.SHRDZM.3C6105FB24B9.3C6105FB24B9.sensor",
        },
        kind: "event",
      },
    });
    const rows = logic.states.Run.on!;
    expect(rows).toHaveLength(1);
    expect(rows[0].on).toBe("source");
    expect(rows[0].do?.code).toContain("JSON.parse");
    expect(rows[0].do?.code).toContain("Array.isArray");
    expect(
      validateLogicDocument({ version: 3, logics: [logic] }).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
  });
});

it("accepts a param description and rejects a non-string", () => {
  const params = template.params ?? [];
  const withDescription = {
    ...template,
    params: [
      { ...params[0], description: "e.g. http://192.168.1.50:8099" },
      ...params.slice(1),
    ],
  };
  expect(validateDeviceTemplate(withDescription).errors).toEqual([]);

  const bad = {
    ...template,
    params: [{ ...params[0], description: 1 }, ...params.slice(1)],
  };
  expect(validateDeviceTemplate(bad).errors).toContain(
    "baseUrl: description must be a string",
  );
});

it("accepts decimals on number items and rejects invalid values", () => {
  const level = template.itemList[1];
  expect(
    validateDeviceTemplate({
      ...template,
      itemList: [{ ...level, decimals: 2 }],
    }).errors,
  ).toEqual([]);
  expect(
    validateDeviceTemplate({
      ...template,
      itemList: [{ ...level, decimals: -1 }],
    }).errors,
  ).toContain("level: decimals must be an integer 0-100");
  expect(
    validateDeviceTemplate({
      ...template,
      itemList: [{ ...level, decimals: 1.5 }],
    }).errors,
  ).toContain("level: decimals must be an integer 0-100");
  expect(
    validateDeviceTemplate({
      ...template,
      itemList: [{ ...template.itemList[0], decimals: 2 }],
    }).errors,
  ).toContain("power: decimals is only for number items");
});
