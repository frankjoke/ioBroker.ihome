import type { Expr, LogicDef, OnRow } from "$logic/types";
import { renameCodeRefs, renameGotoRefs } from "$logic/expr-code";

/**
 * Rewrite every memory reference to `from` as `to` in one logic. A memory is
 * named by a bare ref (`from: {type: "memory", ref}`, a `set` target) or by a
 * literal `get/state/set` call in an expression's code; state and variable refs
 * are dotted or distinct names, so only refs that are exactly the memory name
 * are touched.
 */
export function renameMemoryRefs(
  logic: LogicDef,
  from: string,
  to: string,
): LogicDef {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === "map") {
          out[key] = item;
        } else if (key === "code" && typeof item === "string") {
          out[key] = renameCodeRefs(item, from, to);
        } else {
          out[key] = key === "ref" && item === from ? to : walk(item);
        }
      }
      return out;
    }
    return value;
  };
  return walk(logic) as LogicDef;
}

/**
 * Rewrite every `$logic.<from>` row trigger to `<to>`, so renaming a logic
 * keeps the logics that listen to its output attached.
 */
export function renameLogicRefs(
  logic: LogicDef,
  from: string,
  to: string,
): LogicDef {
  const old = `$logic.${from}`;
  const next = `$logic.${to}`;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = key === "on" && item === old ? next : walk(item);
      }
      return out;
    }
    return value;
  };
  return walk(logic) as LogicDef;
}

/**
 * Rewrite every reference to machine state `from` as `to`: `start`, `after.goto`,
 * row `goto`, a string `init.state` and literal `goto("from")` calls. Dynamic
 * gotos and expression init states are left alone.
 */
export function renameStateRefs(
  logic: LogicDef,
  from: string,
  to: string,
): LogicDef {
  if (logic.kind !== "machine") return logic;
  const rename = (name: string) => (name === from ? to : name);
  const block = (expr: Expr): Expr => ({
    ...expr,
    code: renameGotoRefs(expr.code, from, to),
  });
  const row = (value: OnRow): OnRow => ({
    ...value,
    ...(value.goto !== undefined ? { goto: rename(value.goto) } : {}),
    ...(value.do ? { do: block(value.do) } : {}),
  });
  return {
    ...logic,
    ...(logic.start !== undefined ? { start: rename(logic.start) } : {}),
    ...(typeof logic.init?.state === "string"
      ? { init: { ...logic.init, state: rename(logic.init.state) } }
      : {}),
    states: Object.fromEntries(
      Object.entries(logic.states).map(([name, state]) => [
        name,
        {
          ...state,
          ...(state.after
            ? { after: { ...state.after, goto: rename(state.after.goto) } }
            : {}),
          ...(state.enter ? { enter: block(state.enter) } : {}),
          ...(state.exit ? { exit: block(state.exit) } : {}),
          ...(state.on ? { on: state.on.map(row) } : {}),
        },
      ]),
    ),
    ...(logic.all?.on
      ? { all: { ...logic.all, on: logic.all.on.map(row) } }
      : {}),
  };
}
