import { describe, expect, it } from "vitest";
import {
  applyPartLabel,
  bundleApplyParts,
  bundleDeviceTemplate,
  bundleLogicParams,
  devicesForTemplate,
  logicApplyDefaults,
  planDeviceApply,
  planLogicApply,
  resolveTemplateParams,
  runApplyParts,
  type ApplyParam,
} from "./template-apply";
import type { Device } from "$lib/types/device";
import type { TemplateBundle } from "$lib/types/templates";
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
    expect(planDeviceApply(template, device({ type: "Switch" }))).toMatchObject(
      { problem: expect.stringMatching(/type|Light|Switch/i) },
    );
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

  it("accepts an empty string param but still requires memory", () => {
    const mixed: ApplyParam[] = [
      { name: "host", label: "Host", type: "string" },
      { name: "box", label: "Box", type: "memory" },
    ];
    expect(
      resolveTemplateParams(mixed, { host: "", box: "x" }, (r) => r),
    ).toEqual({ values: { host: "", box: "x" } });
    expect(
      resolveTemplateParams(mixed, { host: "", box: "" }, (r) => r),
    ).toMatchObject({ problem: expect.stringMatching(/Box.*required/i) });
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

const bundle = {
  id: "tv",
  name: "TV",
  params: [
    { name: "host", label: "Host", type: "string" as const },
    { name: "source", label: "Source", type: "state" as const },
    { name: "counter", label: "Counter", type: "memory" as const },
  ],
  device: { type: "Custom" as const, features: [], slots: [] },
  logic: {
    logic: {
      id: "",
      name: "",
      kind: "function" as const,
      inputs: {},
      output: { scope: "memory" as const },
      expr: { code: "noop()" },
    },
  },
  api: { source: "({})" },
} as TemplateBundle;

it("orders the present parts API, Device, Logic", () => {
  expect(bundleApplyParts(bundle)).toEqual(["api", "device", "logic"]);
  expect(bundleApplyParts({ id: "x", name: "X", logic: bundle.logic })).toEqual(
    ["logic"],
  );
  expect(applyPartLabel("api")).toBe("API");
});

it("builds a user visual template from a device part", () => {
  const template = bundleDeviceTemplate(
    {
      type: "Custom",
      features: [
        {
          feature: "power",
          label: "Power",
          widget: "switch",
          roleHints: [],
        },
      ],
      slots: [{ kind: "value", source: "power" }],
      size: { w: 2, h: 2 },
    },
    "new-id",
    "TV",
  );
  expect(template).toMatchObject({
    id: "new-id",
    name: "TV",
    type: "Custom",
    builtin: false,
    size: { w: 2, h: 2 },
  });
  expect(template.features).toHaveLength(1);
  expect(template.slots).toHaveLength(1);
});

it("keeps logic params and drops string/description", () => {
  expect(bundleLogicParams(bundle)).toEqual([
    { name: "source", label: "Source", type: "state" },
    { name: "counter", label: "Counter", type: "memory" },
  ]);
});

it("stops at the first failing part and names it", async () => {
  const calls: string[] = [];
  expect(
    await runApplyParts(["api", "device", "logic"], async (part) => {
      calls.push(part);
      if (part === "device") throw new Error("bad target");
    }),
  ).toEqual({ part: "device", error: "bad target" });
  expect(calls).toEqual(["api", "device"]);
});
