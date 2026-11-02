import type { LogicDef } from "$logic/types";

/**
 * Rewrite every memory reference to `from` as `to` in one logic. A memory is
 * named by a bare ref (`from: {type: "memory", ref}`, an expression `ref`, a
 * `set` target); state and variable refs are dotted or distinct names, so only
 * refs that are exactly the memory name are touched.
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
        out[key] = key === "ref" && item === from ? to : walk(item);
      }
      return out;
    }
    return value;
  };
  return walk(logic) as LogicDef;
}
