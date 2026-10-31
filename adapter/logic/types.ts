// The logic document as stored in ihome.0.config.logicList. Every field the
// engine, the validator and the editor share lives here; the spec
// (docs/superpowers/specs/2026-10-31-ihome-logic-design.md, section 4) is the
// authority when a comment and this file disagree.

export type Json = string | number | boolean | null;

/** Whole seconds, minutes or hours as written in the document: "90s", "2m". */
export type Duration = string;

export type Operator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export type InputSource =
  | { type: "state"; ref: string }
  | { type: "memory"; ref: string }
  | { type: "timer"; every: Duration };

export interface Input {
  from: InputSource;
  /** Default "variable": readable, never triggers. */
  kind?: "variable" | "event";
  /** Event + state inputs only. Default "changed". */
  mode?: "changed" | "any";
  /** Event + state inputs only. Default "any". */
  ack?: "any" | "true" | "false";
}

export type Forward = "changed" | "always";

export type Output =
  | { scope: "memory"; name?: string; forward?: Forward }
  | {
      scope: "state";
      ref: string;
      type: "boolean" | "number" | "string";
      /** Machine outputs only: state name → written value. */
      map?: Record<string, string | number | boolean>;
      forward?: Forward;
    };

export interface Ref {
  ref: string;
}

export type Expr =
  | { const: Json }
  | { ref: string }
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; left: Expr; right: Expr }
  | { op: "and" | "or"; of: Expr[] }
  | { op: "not"; of: Expr }
  | { op: "add" | "sub" | "mul" | "div" | "mod"; left: Expr; right: Expr }
  | { op: "neg" | "round" | "abs"; of: Expr }
  | { op: "min" | "max"; of: Expr[] }
  | { op: "clamp"; of: Expr; min: number; max: number }
  | { op: "len"; of: Expr }
  | { op: "if"; cond: Expr; then: Expr; else: Expr };

/** A function logic answers a value, or "no update" (D15). */
export type FunctionExpr = Expr | { noop: true };

export type Action =
  | {
      set: {
        target: Ref;
        value: Expr;
        /** Default false: a command, not a confirmation. */
        ack?: boolean;
        /** Default "changed". */
        forward?: Forward;
      };
    }
  | { goto: string }
  | { log: { text: string; level?: "info" | "warn" } };

export interface OnRow {
  /** An input name whose kind is "event". */
  on: string;
  /** Test the event value; absent = any change. */
  is?: { op: Operator; value?: Json };
  /** Further condition over any ref, evaluated on the event. */
  if?: Expr;
  do?: Action[];
  /** Absent = stay in the state (no output write). */
  goto?: string;
}

export interface StateDef {
  enter?: Action[];
  exit?: Action[];
  on?: OnRow[];
  after?: { time: Duration; goto: string };
}

export interface LogicBase {
  /** Stable and unique: [a-z0-9-]. */
  id: string;
  name: string;
  /** Default true. */
  enabled?: boolean;
  inputs?: Record<string, Input>;
  /** Default { scope: "memory", name: id }. */
  output?: Output;
  /** Per-logic debug logging, default false. */
  log?: boolean;
}

export interface FunctionLogic extends LogicBase {
  kind: "function";
  expr: FunctionExpr;
}

export interface MachineLogic extends LogicBase {
  kind: "machine";
  /** Default: the first state key. */
  start?: string;
  states: Record<string, StateDef>;
}

export type LogicDef = FunctionLogic | MachineLogic;

export interface MemoryDecl {
  name: string;
  type: "number" | "boolean" | "string";
  initial?: number | boolean | string;
}

export interface TemplateParam {
  name: string;
  label: string;
  type: "state" | "memory" | "number" | "boolean" | "duration";
  default?: string | number | boolean;
}

export interface LogicTemplate {
  id: string;
  name: string;
  description?: string;
  params: TemplateParam[];
  /** String fields may contain {{param}} placeholders. */
  logic: LogicDef;
}

export interface LogicDocument {
  version: 1;
  /** Shared values not tied to a logic output. */
  memory?: MemoryDecl[];
  logics: LogicDef[];
  /** User templates; built-ins live in code. */
  templates?: LogicTemplate[];
}
