import { createContext, runInContext, Script } from "node:vm";
import { wrapExpression } from "./expr-code";
import type { FetchOptions } from "./tasks";
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
  notify(level: "info" | "warn" | "error", title: string, body: string): void;
  fetchJson(
    url: string,
    options: FetchOptions | undefined,
    run: (data: unknown, error: string | null) => void,
    depth: number,
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function fetchOptions(raw: unknown): FetchOptions | undefined {
  if (!isRecord(raw)) return undefined;
  const headers: Record<string, string> = {};
  if (isRecord(raw.headers)) {
    for (const [name, value] of Object.entries(raw.headers)) {
      if (typeof value === "string") headers[name] = value;
    }
  }
  return {
    method: typeof raw.method === "string" ? raw.method : undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: typeof raw.body === "string" ? raw.body : undefined,
  };
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
  /** The state object of the active action block, if any. */
  const objects: unknown[] = [];
  const currentObject = (): unknown => objects[objects.length - 1];
  let inTask = false;

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
  const defineSlot = (name: string): void => {
    Object.defineProperty(sandbox, name, {
      value: undefined,
      writable: true,
      configurable: false,
      enumerable: false,
    });
  };
  for (const slot of [
    "__task_cb",
    "__task_this",
    "__task_data",
    "__task_error",
  ]) {
    defineSlot(slot);
  }
  const taskRunner = new Script(
    "__task_cb.call(__task_this, __task_data, __task_error)",
    { filename: `${def.id}:task` },
  );

  const scripts = new Map<string, Script>();
  const blocks = new WeakMap<Expr, { runner: Script; object: unknown }>();
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

  const compileBlock = (
    expr: Expr,
    path: string,
    stateKey: string,
  ): { runner: Script; object: unknown } => {
    try {
      const block = new Script(`(function () {\n${expr.code}\n})`, {
        filename: `${def.id}:${path}`,
      }).runInContext(context);
      const blockName = `__block_${hiddenCount++}`;
      defineHidden(blockName, block);
      const objectName = stateObject(stateKey);
      const entry = {
        runner: new Script(`${blockName}.call(${objectName})`, {
          filename: `${def.id}:${path}`,
        }),
        object: sandbox[objectName],
      };
      blocks.set(expr, entry);
      return entry;
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
    if (name !== "$self") {
      const info = hooks.describe(name);
      if (info && !info.writable) throw new Error(`${name} is not writable`);
    }
    const { ack, forward } = options(opts);
    hooks.write(name, value, ack, forward, currentDepth());
  });
  define("goto", function (state?: unknown): void {
    if (inTask && arguments.length > 0 && state !== NOACTION) {
      throw new Error("goto is not available in a fetch callback");
    }
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
  define("notify", (title: unknown, body?: unknown, level?: unknown) => {
    hooks.notify(
      messageLevel(level),
      interpolate(String(title ?? ""), (name) => hooks.describe(name)),
      interpolate(String(body ?? ""), (name) => hooks.describe(name)),
    );
  });
  define("noop", () => NOOP);
  define("NOACTION", NOACTION);

  const run = (script: Script, depth: number, object?: unknown): unknown => {
    depths.push(depth);
    if (object !== undefined) objects.push(object);
    try {
      return script.runInContext(context, { timeout: 50 });
    } finally {
      if (object !== undefined) objects.pop();
      depths.pop();
    }
  };

  const runTask = (
    callback: unknown,
    thisObject: unknown,
    data: unknown,
    error: string | null,
    depth: number,
  ): void => {
    sandbox.__task_cb = callback;
    sandbox.__task_this = thisObject;
    sandbox.__task_data = data;
    sandbox.__task_error = error;
    inTask = true;
    try {
      run(taskRunner, depth, thisObject);
    } finally {
      inTask = false;
      sandbox.__task_cb = undefined;
      sandbox.__task_this = undefined;
      sandbox.__task_data = undefined;
      sandbox.__task_error = undefined;
    }
  };

  define(
    "fetchJson",
    (url: unknown, callback: unknown, rawOptions?: unknown) => {
      if (typeof url !== "string" || !isHttpUrl(url)) {
        throw new Error("fetchJson needs an http(s) url");
      }
      if (typeof callback !== "function") {
        throw new Error("fetchJson needs a callback");
      }
      const object = currentObject();
      const depth = currentDepth() + 1;
      hooks.fetchJson(
        url,
        fetchOptions(rawOptions),
        (data, error) => runTask(callback, object, data, error, depth),
        depth,
      );
      return NOOP;
    },
  );

  return {
    runExpr(expr, depth) {
      const script = scripts.get(expr.code);
      if (!script) throw new Error(`expression not compiled: ${expr.code}`);
      return run(script, depth);
    },
    runStatements(expr, depth) {
      // A block outside the definition (a test, a draft) gets its own state.
      const block = blocks.get(expr) ?? compileBlock(expr, "action", "$adhoc");
      return run(block.runner, depth, block.object);
    },
  };
}
