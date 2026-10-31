import type { Expr } from "./types";

/** How an expression reads a name: an input, memory entry or external state. */
export type Resolve = (ref: string) => unknown;

function number(value: unknown, op: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`evaluate: ${op} needs numbers`);
  }
  return value;
}

function list(value: unknown, op: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`evaluate: ${op} needs arrays`);
  return value;
}

/**
 * Evaluate the documented expression tree. Errors are thrown, not guessed:
 * the engine catches them and logs a warning (spec §5.5).
 */
export function evaluate(expr: Expr, resolve: Resolve): unknown {
  if (!expr || typeof expr !== "object") {
    throw new Error("evaluate: not an expression");
  }
  if ("const" in expr) return expr.const;
  if ("ref" in expr) return resolve(expr.ref);

  const e = expr as Extract<Expr, { op: string }>;
  switch (e.op) {
    case "eq":
      return evaluate(e.left, resolve) === evaluate(e.right, resolve);
    case "ne":
      return evaluate(e.left, resolve) !== evaluate(e.right, resolve);
    case "gt":
      return (
        number(evaluate(e.left, resolve), "gt") >
        number(evaluate(e.right, resolve), "gt")
      );
    case "gte":
      return (
        number(evaluate(e.left, resolve), "gte") >=
        number(evaluate(e.right, resolve), "gte")
      );
    case "lt":
      return (
        number(evaluate(e.left, resolve), "lt") <
        number(evaluate(e.right, resolve), "lt")
      );
    case "lte":
      return (
        number(evaluate(e.left, resolve), "lte") <=
        number(evaluate(e.right, resolve), "lte")
      );
    case "and":
      return e.of.every((item) => Boolean(evaluate(item, resolve)));
    case "or":
      return e.of.some((item) => Boolean(evaluate(item, resolve)));
    case "not":
      return !evaluate(e.of, resolve);
    case "add":
      return (
        number(evaluate(e.left, resolve), "add") +
        number(evaluate(e.right, resolve), "add")
      );
    case "sub":
      return (
        number(evaluate(e.left, resolve), "sub") -
        number(evaluate(e.right, resolve), "sub")
      );
    case "mul":
      return (
        number(evaluate(e.left, resolve), "mul") *
        number(evaluate(e.right, resolve), "mul")
      );
    case "div": {
      const right = number(evaluate(e.right, resolve), "div");
      if (right === 0) throw new Error("evaluate: division by zero");
      return number(evaluate(e.left, resolve), "div") / right;
    }
    case "mod": {
      const right = number(evaluate(e.right, resolve), "mod");
      if (right === 0) throw new Error("evaluate: modulo by zero");
      return number(evaluate(e.left, resolve), "mod") % right;
    }
    case "neg":
      return -number(evaluate(e.of, resolve), "neg");
    case "round":
      return Math.round(number(evaluate(e.of, resolve), "round"));
    case "abs":
      return Math.abs(number(evaluate(e.of, resolve), "abs"));
    case "min": {
      const values = list(e.of, "min").map((item) =>
        number(evaluate(item as Expr, resolve), "min"),
      );
      return Math.min(...values);
    }
    case "max": {
      const values = list(e.of, "max").map((item) =>
        number(evaluate(item as Expr, resolve), "max"),
      );
      return Math.max(...values);
    }
    case "clamp": {
      const value = number(evaluate(e.of, resolve), "clamp");
      return Math.min(e.max, Math.max(e.min, value));
    }
    case "len": {
      const value = evaluate(e.of, resolve);
      if (typeof value === "string" || Array.isArray(value))
        return value.length;
      throw new Error("evaluate: len needs a string or array");
    }
    case "if":
      return evaluate(e.cond, resolve)
        ? evaluate(e.then, resolve)
        : evaluate(e.else, resolve);
    default:
      throw new Error(
        `evaluate: unknown op ${String((e as never as { op: string }).op)}`,
      );
  }
}
