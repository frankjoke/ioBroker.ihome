// The logic document as stored in ihome.0.config.logicList. Every field the
// engine, the validator and the editor share lives here; the expression spec
// (docs/superpowers/specs/2026-11-04-logic-code-expressions-design.md) is the
// authority for Expr, the action spec
// (docs/superpowers/specs/2026-11-05-logic-action-code-design.md) for the
// statement blocks, the logic spec
// (docs/superpowers/specs/2026-10-31-ihome-logic-design.md, section 4) for the
// rest.

import type { FetchOptions } from "./tasks";

export type Json = string | number | boolean | null;

/** Whole seconds, minutes or hours as written in the document: "90s", "2m". */
export type Duration = string;

export type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "startsWith"
  | "endsWith"
  | "includes"
  | "notIncludes";

/** Every operator, and the ones that need a value (all of them). */
export const OPERATORS: readonly Operator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "startsWith",
  "endsWith",
  "includes",
  "notIncludes",
];

export type InputSource =
  | { type: "state"; ref: string; refs?: string[] }
  | { type: "memory"; ref: string }
  | { type: "timer"; every: Duration };

export type AstroEvent =
  | "nightEnd"
  | "nauticalDawn"
  | "dawn"
  | "sunrise"
  | "sunriseEnd"
  | "goldenHourEnd"
  | "solarNoon"
  | "goldenHour"
  | "sunsetStart"
  | "sunset"
  | "dusk"
  | "nauticalDusk"
  | "night"
  | "nadir";

/** A repeating trigger of an event: an interval, a daily cron or an astro time. */
export type TimerSpec =
  | Duration
  | { kind: "astro"; event: AstroEvent; offset?: number }
  | {
      kind: "cron";
      /** `HH:MM[:SS]`; each part may be `*`, but not all of them. */
      at: string;
      days?: number[] | "*";
    };

export interface Input {
  from: InputSource;
  /** Variables are read-only values from one source; events trigger rows. */
  kind: "variable" | "event";
  /** Event only: repeating triggers beside `from` (D32). */
  timers?: TimerSpec[];
  /** Legacy (pre row-usage): read as the row default, no longer written. */
  mode?: "changed" | "any";
  ack?: "any" | "true" | "false";
  source?: "external" | "self" | "any";
}

export type Forward = "changed" | "always";

export type OutputType =
  "boolean" | "number" | "string" | "object" | "mixed" | "multistate";

export type Output =
  | { scope: "memory"; name?: string; forward?: Forward }
  | {
      /** A state the adapter creates at `<namespace>.Logic.<logic id>`: a logic
       *  state is a command (writable), hence level.switch / level.state.
       *  `object` is stored as a JSON string with role `text.json`; a machine
       *  writes its state index as a `multistate` number; `mixed` holds any
       *  scalar. */
      scope: "logic";
      type: OutputType;
      /** Number only: show the state as local date/time (role `value.time`). */
      role?: "value.time";
      /** Number only: the created state's `common.unit`. */
      unit?: string;
      /** Boolean only: state names matching this glob write `true`. */
      on?: string;
      /** Legacy explicit map; still read. */
      map?: Record<string, string | number | boolean>;
      forward?: Forward;
    }
  | {
      scope: "state";
      ref: string;
      type: OutputType;
      /** Boolean only: state names matching this glob write `true`
       *  (default "On*"). */
      on?: string;
      /** Legacy explicit map; still read, no longer written by the editor. */
      map?: Record<string, string | number | boolean>;
      forward?: Forward;
    };

export interface Ref {
  ref: string;
}

/** A bare JavaScript expression; "no update" is the runtime value of noop(). */
export type Expr = { code: string };

export interface OnRow {
  /** An input name whose kind is "event", or a built-in trigger: `$init` (this
   *  logic's start), `$self` (a write to its output), `$start` (after every
   *  logic has started), `$always` (every event the machine handles). */
  on: string;
  /** What counts as this row's trigger. Default "change" (legacy `mode: "any"`
   *  on the input still means "any"). */
  edge?: "change" | "rising" | "falling" | "any";
  /** Ack filter for this usage; default "any". */
  ack?: "any" | "true" | "false";
  /** Which writers may trigger this usage; default "external". */
  source?: "external" | "self" | "any";
  /** Test the event value; absent = any change. */
  is?: { op: Operator; value?: Json };
  /** Further condition over any ref, evaluated on the event. */
  if?: Expr;
  /** Written to the log before the action runs. */
  log?: { text: string; level?: "info" | "warn" };
  /** Which side acts: a plain `goto` or the `do` code. Default "goto"; the
   *  other side may stay stored but does not run. */
  mode?: "goto" | "function";
  /** Absent = stay in the state (no output write). */
  goto?: string;
  /** Statement block; `goto("State")` inside it transitions. */
  do?: Expr;
  /** After this row's action, keep checking the following rows of the same
   *  state for the same event. A row that transitions still ends the event. */
  continue?: boolean;
}

export interface StateDef {
  enter?: Expr;
  exit?: Expr;
  on?: OnRow[];
  after?: { time: Duration; goto: string };
}

export interface Init {
  /** Machine: state name or an expression that answers one. */
  state?: string | Expr;
  /** Machine: infer the state from the current output value. */
  match?: "output";
  /** Function: run the start evaluation (default true).
   *  Machine: evaluate the `$init` rows after entering (default false). */
  run?: boolean;
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
  /** Startup policy (spec 5.8). */
  init?: Init;
  /** Per-logic debug logging, default false. */
  log?: boolean;
  /** Enum overrides (`enum.rooms.*`, `enum.functions.*`). Empty inherits from the
   *  output state's own members. */
  enums?: string[];
}

export interface FunctionLogic extends LogicBase {
  kind: "function";
  expr: Expr;
}

export interface MachineLogic extends LogicBase {
  kind: "machine";
  /** Default: the first state key. */
  start?: string;
  states: Record<string, StateDef>;
  /** Rows appended after every state's own rows (D31); never entered or a
   *  goto target. Only `on` exists — no enter/exit/after. */
  all?: { on?: OnRow[] };
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
  /** Help text under the field in the apply form. */
  description?: string;
}

export interface LogicTemplate {
  id: string;
  name: string;
  description?: string;
  params: TemplateParam[];
  /** String fields may contain {{param}} placeholders. */
  logic: LogicDef;
}

export interface DeviceParam {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "duration" | "state";
  default?: string | number | boolean;
  /** Help text under the field in the apply form. */
  description?: string;
}

export interface DeviceItem {
  name: string;
  label?: string;
  type: "boolean" | "number" | "string" | "object";
  role?: string;
  unit?: string;
  states?: Record<string, string> | string;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
  initial?: unknown;
  /** Dot path for a string, or exact keys for an array (dots allowed). */
  source?: string | Array<string | number>;
  /** Number only: default read rounding when no conversion is given. */
  decimals?: number;
  /** Device feature name; derived from role/type when omitted. */
  feature?: string;
  /** Hide the generated device control; the state still exists. */
  hidden?: boolean;
  updateAlways?: boolean;
  ack?: boolean;
  foreignWriteName?: string;
  conversion?: (result: unknown, raw: unknown) => unknown;
  setConversion?: (value: unknown) => unknown;
}

export interface DeviceTemplateShape {
  /** Default "http"; "state" listens to one state instead of polling. */
  readFrom?: "http" | "state";
  /** Device type for the optional device entry; unknown types fall back to Custom. */
  deviceType?: string;
  params?: DeviceParam[];
  itemList: DeviceItem[];
  readRequest?(params: Record<string, unknown>): {
    url: string;
    options?: FetchOptions;
  };
  writeRequest?(
    value: unknown,
    item: DeviceItem,
    params: Record<string, unknown>,
  ): { url: string; options?: FetchOptions };
}

export interface DeviceTemplate {
  id: string;
  name: string;
  description?: string;
  source: string;
}

export interface LogicDocument {
  version: 3;
  /** Shared values not tied to a logic output. */
  memory?: MemoryDecl[];
  logics: LogicDef[];
  /** User templates; built-ins live in code. */
  templates?: LogicTemplate[];
  /** JS device templates; the adapter ignores them. */
  deviceTemplates?: DeviceTemplate[];
}
