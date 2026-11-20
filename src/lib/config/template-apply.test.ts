import { describe, expect, it } from "vitest";
import {
  applyPartLabel,
  bundleApplyParts,
  bundleLogicParams,
  logicApplyDefaults,
  planLogicApply,
  resolveTemplateParams,
  runApplyParts,
  type ApplyParam,
} from "./template-apply";
import type { TemplateBundle } from "$lib/types/templates";
import type { LogicTemplate, TemplateParam } from "$logic/types";

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
    {
      name: "source",
      label: "Source",
      type: "state" as const,
      description: "The state to read.",
    },
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

it("orders the present parts API, Logic", () => {
  expect(bundleApplyParts(bundle)).toEqual(["api", "logic"]);
  expect(bundleApplyParts({ id: "x", name: "X", logic: bundle.logic })).toEqual(
    ["logic"],
  );
  expect(applyPartLabel("api")).toBe("API");
});

it("keeps logic params and drops string/description", () => {
  expect(bundleLogicParams(bundle)).toEqual([
    {
      name: "source",
      label: "Source",
      type: "state",
      description: "The state to read.",
    },
    { name: "counter", label: "Counter", type: "memory" },
  ]);
});

it("stops at the first failing part and names it", async () => {
  const calls: string[] = [];
  expect(
    await runApplyParts(["api", "logic"], async (part) => {
      calls.push(part);
      if (part === "logic") throw new Error("bad target");
    }),
  ).toEqual({ part: "logic", error: "bad target" });
  expect(calls).toEqual(["api", "logic"]);
});
