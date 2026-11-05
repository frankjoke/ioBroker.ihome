import type { LogicDef } from "$logic/types";
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
        if (key === "code" && typeof item === "string") {
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
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === "code" && typeof item === "string") {
          out[key] = renameGotoRefs(item, from, to);
        } else if (
          (key === "goto" || key === "start" || key === "state") &&
          item === from
        ) {
          out[key] = to;
        } else {
          out[key] = walk(item);
        }
      }
      return out;
    }
    return value;
  };
  return walk(logic) as LogicDef;
}
