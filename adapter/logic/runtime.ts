import { createContext, runInContext, Script } from "node:vm";
import { wrapExpression } from "./expr-code";
import type { Expr, Forward, LogicDef } from "./types";

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
  write(
    name: string,
    value: unknown,
    ack: boolean,
    forward: Forward | undefined,
    depth: number,
  ): void;
  log(level: "info" | "warn", message: string): void;
  message(
    level: "info" | "warn" | "error",
    message: string,
    timeout?: number,
  ): void;
  now(): number;
}

export interface LogicRuntime {
  runExpr(expr: Expr, depth: number): unknown;
  runStatements(expr: Expr, depth: number): unknown;
}

/** The module-private "no update" sentinel a function result may return. */
const NOOP = Symbol("noop");

/** The value `goto(NOACTION)` takes: stay in the state, change nothing. */
export const NOACTION: symbol = Symbol("NOACTION");

const GOTO = Symbol("goto");

/** What `goto("State")` throws; the engine turns it into a transition. */
export interface GotoSignal {
  readonly state: string;
}

export function isGotoSignal(value: unknown): value is GotoSignal {
  return (
    value != null &&
    typeof value === "object" &&
    (value as Record<symbol, unknown>)[GOTO] === true
  );
}

export function isNoop(value: unknown): boolean {
  return Object.is(value, NOOP);
}

export type ExprMode = "expression" | "statements";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.code === "string";
}

type ExprVisitor = (
  expr: Expr,
  path: string,
  mode: ExprMode,
  stateKey?: string,
) => void;

function forEachRow(
  rows: unknown,
  path: string,
  stateKey: string,
  fn: ExprVisitor,
): void {
  if (!Array.isArray(rows)) return;
  rows.forEach((row, index) => {
    if (!isRecord(row)) return;
    if (isExpr(row.if)) fn(row.if, `${path}.${index}.if`, "expression");
    if (isExpr(row.do)) {
      fn(row.do, `${path}.${index}.do`, "statements", stateKey);
    }
  });
}

/** Walk every expression and action block of one logic, with the path a
 *  compile error names. */
export function forEachExpression(logic: LogicDef, fn: ExprVisitor): void {
  if (!isRecord(logic)) return;
  if (logic.kind === "function") {
    if (isExpr(logic.expr)) fn(logic.expr, "expr", "expression");
    return;
  }
  if (isExpr(logic.init?.state)) {
    fn(logic.init.state, "init.state", "expression");
  }
  const states = isRecord(logic.states) ? logic.states : {};
  for (const [name, value] of Object.entries(states)) {
    if (!isRecord(value)) continue;
    if (isExpr(value.enter)) {
      fn(value.enter, `states.${name}.enter`, "statements", name);
    }
    if (isExpr(value.exit)) {
      fn(value.exit, `states.${name}.exit`, "statements", name);
    }
    forEachRow(value.on, `states.${name}.on`, name, fn);
  }
  forEachRow(logic.all?.on, "all.on", "$all", fn);
}

/** Replace `{{name}}` with the name's current value ("—" when unknown). */
export function interpolate(
  text: string,
  describe: (name: string) => NameInfo | undefined,
): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_match, name: string) => {
    const value = describe(name.trim())?.value;
    return value === undefined ? "—" : String(value);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `Info`/`Warning`/`Error` and the short `warn` all work. */
function messageLevel(value: unknown): "info" | "warn" | "error" {
  const level = String(value ?? "info").toLowerCase();
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warn";
  return "info";
}

/**
 * One long-lived vm context per logic. Compiling and running are separate so a
 * syntax error stops this logic at load while the others still run.
 */
export function createLogicRuntime(
  def: LogicDef,
  hooks: RuntimeHooks,
): LogicRuntime {
  const depths: number[] = [];
  const currentDepth = (): number => depths[depths.length - 1] ?? 0;

  const sandbox = Object.create(null);
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  // Node injects a console into every new context; the expression API has none.
  runInContext("delete globalThis.console", context);

  const define = (name: string, value: unknown, enumerable = true): void => {
    Object.defineProperty(sandbox, name, {
      value,
      writable: false,
      configurable: false,
      enumerable,
    });
  };
  const defineHidden = (name: string, value: unknown): void =>
    define(name, value, false);

  const scripts = new Map<string, Script>();
  const runners = new WeakMap<Expr, Script>();
  const stateNames = new Map<string, string>();
  let hiddenCount = 0;

  const compileExpression = (expr: Expr, path: string): void => {
    if (scripts.has(expr.code)) return;
    try {
      scripts.set(
        expr.code,
        new Script(wrapExpression(expr.code), {
          filename: `${def.id}:${path}`,
        }),
      );
    } catch (error) {
      throw new Error(
        `${path}: expression failed to compile: ${errorText(error)}`,
      );
    }
  };

  // One plain `this` per state, shared by its enter, exit and rows.
  const stateObject = (stateKey: string): string => {
    let name = stateNames.get(stateKey);
    if (!name) {
      name = `__state_${hiddenCount++}`;
      defineHidden(name, runInContext("({})", context));
      stateNames.set(stateKey, name);
    }
    return name;
  };

  const compileBlock = (expr: Expr, path: string, stateKey: string): Script => {
    try {
      const block = new Script(`(function () {\n${expr.code}\n})`, {
        filename: `${def.id}:${path}`,
      }).runInContext(context);
      const blockName = `__block_${hiddenCount++}`;
      defineHidden(blockName, block);
      const runner = new Script(`${blockName}.call(${stateObject(stateKey)})`, {
        filename: `${def.id}:${path}`,
      });
      runners.set(expr, runner);
      return runner;
    } catch (error) {
      throw new Error(
        `${path}: action code failed to compile: ${errorText(error)}`,
      );
    }
  };

  forEachExpression(def, (expr, path, mode, stateKey) => {
    if (mode === "expression") compileExpression(expr, path);
    else compileBlock(expr, path, stateKey ?? "$all");
  });

  const options = (
    opts: unknown,
  ): { ack: boolean; forward: Forward | undefined } => {
    if (typeof opts === "boolean") return { ack: opts, forward: undefined };
    if (isRecord(opts)) {
      const forward = opts.forward;
      return {
        ack: opts.ack === true,
        forward:
          forward === "always" || forward === "changed" ? forward : undefined,
      };
    }
    return { ack: false, forward: undefined };
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
      set(value: unknown, opts?: unknown): void {
        if (!writable) throw new Error(`${name} is not writable`);
        const { ack, forward } = options(opts);
        hooks.write(name, value, ack, forward, currentDepth());
      },
    });
  });
  define("set", (name: string, value: unknown, opts?: unknown) => {
    const info = hooks.describe(name);
    if (info && !info.writable) throw new Error(`${name} is not writable`);
    const { ack, forward } = options(opts);
    hooks.write(name, value, ack, forward, currentDepth());
  });
  define("goto", function (state?: unknown): void {
    // `arguments` tells goto() (stay) from goto(undefined) (a mistake).
    if (arguments.length === 0 || state === NOACTION) return;
    if (typeof state === "string" && state !== "") {
      throw { [GOTO]: true, state };
    }
    throw new Error("goto needs a state name");
  });
  define("log", (text: unknown, level?: unknown) => {
    hooks.log(
      level === "warn" ? "warn" : "info",
      interpolate(String(text), (name) => hooks.describe(name)),
    );
  });
  define("message", (text: unknown, level?: unknown, timeout?: unknown) => {
    const seconds =
      typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0
        ? timeout
        : undefined;
    hooks.message(
      messageLevel(level),
      interpolate(String(text), (name) => hooks.describe(name)),
      seconds,
    );
  });
  define("noop", () => NOOP);
  define("NOACTION", NOACTION);

  const run = (script: Script, depth: number): unknown => {
    depths.push(depth);
    try {
      return script.runInContext(context, { timeout: 50 });
    } finally {
      depths.pop();
    }
  };

  return {
    runExpr(expr, depth) {
      const script = scripts.get(expr.code);
      if (!script) throw new Error(`expression not compiled: ${expr.code}`);
      return run(script, depth);
    },
    runStatements(expr, depth) {
      // A block outside the definition (a test, a draft) gets its own state.
      const runner =
        runners.get(expr) ?? compileBlock(expr, "action", "$adhoc");
      return run(runner, depth);
    },
  };
}
