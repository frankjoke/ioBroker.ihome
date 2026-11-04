import { createContext, Script } from "node:vm";
import { wrapExpression } from "./expr-code";
import type { Expr, LogicDef } from "./types";

/** How one name looks to `get`/`state`/`set` during an evaluation. */
export interface NameInfo {
  value: unknown;
  ack: boolean;
  from?: string;
  ts: number;
  changed: boolean;
  writable: boolean;
}

/** Everything the runtime needs from the engine; the engine owns the state. */
export interface RuntimeHooks {
  describe(name: string): NameInfo | undefined;
  write(name: string, value: unknown, ack: boolean, depth: number): void;
  now(): number;
}

export interface LogicRuntime {
  run(code: string, depth: number): unknown;
}

/** The module-private "no update" sentinel a function result may return. */
const NOOP = Symbol("noop");

export function isNoop(value: unknown): boolean {
  return Object.is(value, NOOP);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.code === "string";
}

function forEachAction(
  actions: unknown,
  path: string,
  fn: (code: string, path: string) => void,
): void {
  if (!Array.isArray(actions)) return;
  actions.forEach((action, index) => {
    if (!isRecord(action) || !isRecord(action.set)) return;
    if (isExpr(action.set.value)) {
      fn(action.set.value.code, `${path}.${index}.set.value`);
    }
  });
}

function forEachRow(
  rows: unknown,
  path: string,
  fn: (code: string, path: string) => void,
): void {
  if (!Array.isArray(rows)) return;
  rows.forEach((row, index) => {
    if (!isRecord(row)) return;
    if (isExpr(row.if)) fn(row.if.code, `${path}.${index}.if`);
    forEachAction(row.do, `${path}.${index}.do`, fn);
  });
}

/** Walk every expression of one logic, with the path a compile error names. */
export function forEachExpression(
  logic: LogicDef,
  fn: (code: string, path: string) => void,
): void {
  if (!isRecord(logic)) return;
  if (logic.kind === "function") {
    if (isExpr(logic.expr)) fn(logic.expr.code, "expr");
    return;
  }
  if (isExpr(logic.init?.state)) fn(logic.init.state.code, "init.state");
  const states = isRecord(logic.states) ? logic.states : {};
  for (const [name, value] of Object.entries(states)) {
    if (!isRecord(value)) continue;
    forEachAction(value.enter, `states.${name}.enter`, fn);
    forEachAction(value.exit, `states.${name}.exit`, fn);
    forEachRow(value.on, `states.${name}.on`, fn);
  }
  forEachRow(logic.all?.on, "all.on", fn);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One long-lived vm context per logic. Compiling and running are separate so a
 * syntax error stops this logic at load while the others still run.
 */
export function createLogicRuntime(
  def: LogicDef,
  hooks: RuntimeHooks,
): LogicRuntime {
  const scripts = new Map<string, Script>();
  forEachExpression(def, (code, path) => {
    if (scripts.has(code)) return;
    try {
      scripts.set(
        code,
        new Script(wrapExpression(code), { filename: `${def.id}:${path}` }),
      );
    } catch (error) {
      throw new Error(
        `${path}: expression failed to compile: ${errorText(error)}`,
      );
    }
  });

  const depths: number[] = [];
  const currentDepth = (): number => depths[depths.length - 1] ?? 0;

  const sandbox = Object.create(null);
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(sandbox, name, {
      value,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  };

  define("get", (name: string) => hooks.describe(name)?.value);
  define("state", (name: string) => {
    const info = hooks.describe(name);
    const writable = info?.writable ?? true;
    return Object.freeze({
      value: info?.value,
      ack: info?.ack ?? true,
      from: info?.from,
      ts: info?.ts ?? hooks.now(),
      changed: info?.changed ?? false,
      set(value: unknown, ack = false): void {
        if (!writable) throw new Error(`${name} is not writable`);
        hooks.write(name, value, ack, currentDepth());
      },
    });
  });
  define("set", (name: string, value: unknown, ack = false) => {
    const info = hooks.describe(name);
    if (info && !info.writable) throw new Error(`${name} is not writable`);
    hooks.write(name, value, ack, currentDepth());
  });
  define("noop", () => NOOP);

  return {
    run(code, depth) {
      const script = scripts.get(code);
      if (!script) throw new Error(`expression not compiled: ${code}`);
      depths.push(depth);
      try {
        return script.runInContext(context, { timeout: 50 });
      } finally {
        depths.pop();
      }
    },
  };
}
