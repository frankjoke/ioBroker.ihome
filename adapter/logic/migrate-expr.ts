// v1 is migrated in memory: the printer turns the old expression tree into
// plain JavaScript, the migrator walks the document explicitly (never a generic
// "looks like an Expr" walk) and copies it, so the stored document is untouched.

type Json = string | number | boolean | null;

/** The expression tree of a version 1 document. */
export type OldExpr =
  | { const: Json }
  | { ref: string }
  | {
      op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
      left: OldExpr;
      right: OldExpr;
    }
  | { op: "and" | "or"; of: OldExpr[] }
  | { op: "not"; of: OldExpr }
  | {
      op: "add" | "sub" | "mul" | "div" | "mod";
      left: OldExpr;
      right: OldExpr;
    }
  | { op: "neg" | "round" | "abs"; of: OldExpr }
  | { op: "min" | "max"; of: OldExpr[] }
  | { op: "clamp"; of: OldExpr; min: number; max: number }
  | { op: "len"; of: OldExpr }
  | { op: "if"; cond: OldExpr; then: OldExpr; else: OldExpr };

export type OldFunctionExpr = OldExpr | { noop: true };

const TERNARY = 1;
const OR = 2;
const AND = 3;
const UNARY = 8;
const CALL = 9;
const PRIMARY = 10;

/** Comparison and arithmetic operators, with their precedence. */
const BINARY: Record<string, [text: string, prec: number]> = {
  eq: ["===", 4],
  ne: ["!==", 4],
  gt: [">", 5],
  gte: [">=", 5],
  lt: ["<", 5],
  lte: ["<=", 5],
  add: ["+", 6],
  sub: ["-", 6],
  mul: ["*", 7],
  div: ["/", 7],
  mod: ["%", 7],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function wrap(code: string, prec: number, min: number): string {
  return prec < min ? `(${code})` : code;
}

function print(expr: OldFunctionExpr, min: number): string {
  if (!isRecord(expr)) throw new Error("migrate: not an expression");
  if ("noop" in expr) return wrap("noop()", CALL, min);
  if ("const" in expr) return wrap(JSON.stringify(expr.const), PRIMARY, min);
  if ("ref" in expr) return wrap(`get(${JSON.stringify(expr.ref)})`, CALL, min);

  const op = expr.op;
  const binary = Object.hasOwn(BINARY, op) ? BINARY[op] : undefined;
  if (binary) {
    const node = expr as { left: OldExpr; right: OldExpr };
    return wrap(
      `${print(node.left, binary[1])} ${binary[0]} ${print(node.right, binary[1] + 1)}`,
      binary[1],
      min,
    );
  }

  switch (op) {
    case "and":
    case "or": {
      const prec = op === "and" ? AND : OR;
      if (expr.of.length === 0) {
        return wrap(op === "and" ? "true" : "false", PRIMARY, min);
      }
      const text = expr.of
        .map((item) => print(item, prec))
        .join(op === "and" ? " && " : " || ");
      return wrap(text, prec, min);
    }
    case "not":
      return wrap(`!${print(expr.of, UNARY + 1)}`, UNARY, min);
    case "neg": {
      const operand = print(expr.of, UNARY + 1);
      // a negative literal would otherwise print as the invalid `--1`
      return wrap(
        `-${operand.startsWith("-") ? " " : ""}${operand}`,
        UNARY,
        min,
      );
    }
    case "round":
      return wrap(`Math.round(${print(expr.of, 0)})`, CALL, min);
    case "abs":
      return wrap(`Math.abs(${print(expr.of, 0)})`, CALL, min);
    case "min":
    case "max":
      return wrap(
        `Math.${op}(${expr.of.map((item) => print(item, 0)).join(", ")})`,
        CALL,
        min,
      );
    case "clamp":
      return wrap(
        `Math.min(${expr.max}, Math.max(${expr.min}, ${print(expr.of, 0)}))`,
        CALL,
        min,
      );
    case "len":
      return wrap(`(${print(expr.of, 0)}).length`, CALL, min);
    case "if":
      return wrap(
        `${print(expr.cond, OR)} ? ${print(expr.then, TERNARY)} : ${print(expr.else, TERNARY)}`,
        TERNARY,
        min,
      );
    default:
      throw new Error(
        `migrate: unknown op ${String((expr as { op?: unknown }).op)}`,
      );
  }
}

/** Print one v1 expression as JavaScript code. */
export function printExpr(expr: OldFunctionExpr): string {
  return print(expr, 0);
}

function migrateActions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((action) => {
    if (!isRecord(action) || !isRecord(action.set)) return action;
    return {
      ...action,
      set: {
        ...action.set,
        value: { code: printExpr(action.set.value as OldExpr) },
      },
    };
  });
}

function migrateRows(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (!isRecord(row)) return row;
    const out: Record<string, unknown> = { ...row };
    if (isRecord(row.if)) out.if = { code: printExpr(row.if as OldExpr) };
    if (row.do !== undefined) out.do = migrateActions(row.do);
    return out;
  });
}

function migrateState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const state: Record<string, unknown> = { ...value };
  if (value.enter !== undefined) state.enter = migrateActions(value.enter);
  if (value.exit !== undefined) state.exit = migrateActions(value.exit);
  if (value.on !== undefined) state.on = migrateRows(value.on);
  return state;
}

function migrateLogic(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const logic: Record<string, unknown> = { ...value };

  if (logic.kind === "function" && isRecord(logic.expr)) {
    logic.expr = { code: printExpr(logic.expr as OldFunctionExpr) };
  }
  if (
    isRecord(logic.init) &&
    isRecord((logic.init as Record<string, unknown>).state)
  ) {
    const init = logic.init as Record<string, unknown>;
    logic.init = { ...init, state: { code: printExpr(init.state as OldExpr) } };
  }
  if (isRecord(logic.states)) {
    logic.states = Object.fromEntries(
      Object.entries(logic.states).map(([name, state]) => [
        name,
        migrateState(state),
      ]),
    );
  }
  if (isRecord(logic.all) && logic.all.on !== undefined) {
    logic.all = { ...logic.all, on: migrateRows(logic.all.on) };
  }
  return logic;
}

function migrateTemplate(value: unknown): unknown {
  if (!isRecord(value) || !("logic" in value)) return value;
  return { ...value, logic: migrateLogic(value.logic) };
}

/** Convert a v1 document to the v2 shape without touching the input. */
export function migrateDocument(doc: unknown): Record<string, unknown> {
  if (!isRecord(doc)) throw new Error("migrate: document is not an object");
  const out: Record<string, unknown> = { ...doc, version: 2 };
  if (Array.isArray(doc.logics)) out.logics = doc.logics.map(migrateLogic);
  if (Array.isArray(doc.templates)) {
    out.templates = doc.templates.map(migrateTemplate);
  }
  return out;
}
