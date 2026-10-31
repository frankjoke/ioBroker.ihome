import type { LogicDef, LogicTemplate } from "./types";

/**
 * The templates ship as data, exactly like a user template; inserting one
 * copies it into the document with its parameters substituted (D12). No
 * runtime indirection, so the engine only ever sees normal logics.
 */
export const BUILTIN_TEMPLATES: LogicTemplate[] = [
  {
    id: "light-switch-off-delay",
    name: "Switch light with off-delay",
    description:
      "Switches a light on when the switch turns on and off again after the delay without a new on signal.",
    params: [
      { name: "switch", label: "Switch state", type: "state" },
      { name: "light", label: "Light state", type: "state" },
      { name: "delay", label: "Off after", type: "duration", default: "5m" },
    ],
    logic: {
      id: "logik",
      name: "Switch light",
      kind: "machine",
      inputs: {
        sw: {
          from: { type: "state", ref: "{{switch}}" },
          kind: "event",
        },
        light: { from: { type: "state", ref: "{{light}}" } },
      },
      output: { scope: "memory" },
      start: "Idle",
      states: {
        Idle: {
          on: [{ on: "sw", is: { op: "eq", value: true }, goto: "On" }],
        },
        On: {
          enter: [
            { set: { target: { ref: "light" }, value: { const: true } } },
          ],
          exit: [
            { set: { target: { ref: "light" }, value: { const: false } } },
          ],
          on: [{ on: "sw", is: { op: "eq", value: true }, goto: "On" }],
          after: { time: "{{delay}}", goto: "Idle" },
        },
      },
    },
  },
  {
    id: "light-motion-off-delay",
    name: "Motion light with off-delay",
    description:
      "Switches a light on on motion and off again after the delay without new motion.",
    params: [
      { name: "motion", label: "Motion state", type: "state" },
      { name: "light", label: "Light state", type: "state" },
      { name: "delay", label: "Off after", type: "duration", default: "2m" },
    ],
    logic: {
      id: "logik",
      name: "Motion light",
      kind: "machine",
      inputs: {
        motion: {
          from: { type: "state", ref: "{{motion}}" },
          kind: "event",
        },
        light: { from: { type: "state", ref: "{{light}}" } },
      },
      output: { scope: "memory" },
      start: "Idle",
      states: {
        Idle: {
          on: [{ on: "motion", is: { op: "eq", value: true }, goto: "On" }],
        },
        On: {
          enter: [
            { set: { target: { ref: "light" }, value: { const: true } } },
          ],
          exit: [
            { set: { target: { ref: "light" }, value: { const: false } } },
          ],
          on: [{ on: "motion", is: { op: "eq", value: true }, goto: "On" }],
          after: { time: "{{delay}}", goto: "Idle" },
        },
      },
    },
  },
  {
    id: "computed-value",
    name: "Computed value",
    description:
      "Writes the source value multiplied by a factor into a state whenever it changes.",
    params: [
      { name: "source", label: "Source state", type: "state" },
      { name: "target", label: "Target state", type: "state" },
      { name: "factor", label: "Factor", type: "number", default: 1 },
    ],
    logic: {
      id: "logik",
      name: "Computed value",
      kind: "function",
      inputs: {
        value: {
          from: { type: "state", ref: "{{source}}" },
          kind: "event",
        },
      },
      output: { scope: "state", ref: "{{target}}", type: "number" },
      expr: {
        op: "mul",
        left: { ref: "value" },
        right: { const: "{{factor}}" },
      },
    },
  },
];

/**
 * Copy a template into a concrete logic. A parameter without a value falls
 * back to its default; a parameter with neither throws, so the editor's
 * "insert" button stays disabled until it is filled.
 */
export function instantiateTemplate(
  template: LogicTemplate,
  params: Record<string, string | number | boolean>,
  id: string,
): LogicDef {
  const values: Record<string, string | number | boolean> = {};
  for (const param of template.params) {
    const value = params[param.name];
    if (value === undefined || value === "") {
      if (param.default === undefined) {
        throw new Error(`missing parameter: ${param.name}`);
      }
      values[param.name] = param.default;
    } else {
      values[param.name] = value;
    }
  }
  const logic = substitute(
    JSON.parse(JSON.stringify(template.logic)),
    values,
  ) as LogicDef;
  logic.id = id;
  logic.name = template.name;
  if (logic.output?.scope === "memory" && !logic.output.name) {
    logic.output.name = id;
  }
  return logic;
}

const EXACT = /^\{\{(\w+)\}\}$/;
const INLINE = /\{\{(\w+)\}\}/g;

function substitute(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = EXACT.exec(value);
    if (exact) return params[exact[1]];
    return value.replace(INLINE, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }
  if (Array.isArray(value))
    return value.map((item) => substitute(item, params));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substitute(item, params);
    }
    return out;
  }
  return value;
}
