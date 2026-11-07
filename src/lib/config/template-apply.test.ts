import { describe, expect, it } from "vitest";
import {
  devicesForTemplate,
  logicApplyDefaults,
  planDeviceApply,
  planLogicApply,
  resolveTemplateParams,
} from "./template-apply";
import type { Device } from "$lib/types/device";
import type { LogicTemplate, TemplateParam } from "$logic/types";

const template = {
  id: "Light",
  name: "Light",
  type: "Light" as const,
  features: [],
  slots: [],
};
const device = (over: Partial<Device> = {}): Device => ({
  id: "d1",
  name: "Ceiling",
  type: "Light",
  controls: [],
  slots: [{ kind: "value", source: "power" }],
  ...over,
});

describe("planDeviceApply", () => {
  it("offers only matching devices and sets only template", () => {
    const light = device();
    const switchDevice = device({ id: "d2", name: "Switch", type: "Switch" });
    expect(
      devicesForTemplate(template, [switchDevice, light]).map((d) => d.id),
    ).toEqual(["d1"]);
    const plan = planDeviceApply(template, light);
    expect("device" in plan && plan.device.template).toBe("Light");
    expect("device" in plan && plan.device.slots).toEqual(light.slots);
    expect("device" in plan && plan.device.controls).toEqual(light.controls);
  });

  it("refuses a missing device and a type mismatch", () => {
    expect(planDeviceApply(template, undefined)).toMatchObject({
      problem: expect.stringMatching(/choose/i),
    });
    expect(
      planDeviceApply(template, device({ type: "Switch" })),
    ).toMatchObject({ problem: expect.stringMatching(/type|Light|Switch/i) });
  });
});

describe("logicApplyDefaults", () => {
  it("uses defaults and per-type fallbacks", () => {
    const params: TemplateParam[] = [
      { name: "source", label: "Source", type: "state" },
      { name: "wait", label: "Wait", type: "duration", default: "5m" },
      { name: "level", label: "Level", type: "number" },
      { name: "on", label: "On", type: "boolean" },
      { name: "box", label: "Box", type: "memory" },
    ];
    expect(logicApplyDefaults(params)).toEqual({
      source: "",
      wait: "5m",
      level: 0,
      on: false,
      box: "",
    });
  });
});

describe("resolveTemplateParams", () => {
  const params: TemplateParam[] = [
    { name: "source", label: "Source", type: "state" },
    { name: "wait", label: "Wait", type: "duration" },
    { name: "box", label: "Box", type: "memory" },
  ];

  it("resolves a state ref and accepts a duration", () => {
    const result = resolveTemplateParams(
      params,
      { source: "alias.0.X", wait: "5m", box: "counter" },
      (ref) => `id:${ref}`,
    );
    expect(result).toEqual({
      values: { source: "id:alias.0.X", wait: "5m", box: "counter" },
    });
  });

  it("refuses an empty state, a bad duration and a missing memory", () => {
    expect(
      resolveTemplateParams(
        params,
        { source: "", wait: "5m", box: "x" },
        (r) => r,
      ),
    ).toMatchObject({ problem: expect.stringMatching(/Source.*state/i) });
    expect(
      resolveTemplateParams(
        params,
        { source: "a", wait: "soon", box: "x" },
        (r) => r,
      ),
    ).toMatchObject({ problem: expect.stringMatching(/30s|duration|Wait/i) });
    expect(
      resolveTemplateParams(
        params,
        { source: "a", wait: "5m", box: "" },
        (r) => r,
      ),
    ).toMatchObject({ problem: expect.stringMatching(/Box.*required/i) });
  });
});

const ghostTemplate: LogicTemplate = {
  id: "ghost-user",
  name: "Ghost user",
  params: [],
  logic: {
    id: "",
    name: "",
    kind: "machine",
    inputs: {},
    output: { scope: "memory" },
    init: { run: false },
    start: "Idle",
    states: { Idle: { on: [{ on: "$logic.ghost", goto: "Idle" }] } },
  },
};

const ghostLogic = {
  id: "ghost",
  name: "Ghost",
  kind: "function" as const,
  inputs: {},
  output: { scope: "memory" as const, name: "ghost" },
  expr: { code: "noop()" },
};

const plainTemplate: LogicTemplate = {
  id: "plain",
  name: "Plain",
  params: [],
  logic: {
    id: "",
    name: "",
    kind: "function",
    inputs: {},
    output: { scope: "memory" },
    expr: { code: "noop()" },
  },
};

describe("planLogicApply", () => {
  it("inserts with a unique id", () => {
    const plan = planLogicApply(plainTemplate, {}, ["plain"]);
    expect("logic" in plan && plan.logic.id).toBe("plain-2");
  });

  it("refuses an unresolved $logic ref and accepts a resolved one", () => {
    expect(planLogicApply(ghostTemplate, {}, [], [])).toMatchObject({
      problem: expect.stringMatching(/ghost|unknown/i),
    });
    expect(planLogicApply(ghostTemplate, {}, [], [ghostLogic])).toEqual({
      logic: expect.objectContaining({ id: "ghost-user" }),
    });
  });
});
