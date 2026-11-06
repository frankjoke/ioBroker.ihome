import type { LogicDef } from "./types";
import type { StateSpec } from "./state-common";

export function numberStatesOf(
  def: LogicDef,
): Record<string, string> | undefined {
  if (def.kind !== "machine") return undefined;
  const names = Object.keys(def.states ?? {});
  if (names.length === 0) return undefined;
  return Object.fromEntries(names.map((name, index) => [String(index), name]));
}

/** The desired object for an ihome-created logic output state. */
export function logicOutputSpec(
  def: LogicDef,
  namespace: string,
): StateSpec | undefined {
  const output = def.output;
  if (output?.scope !== "logic") return undefined;
  const object = output.type === "object";
  return {
    id: `${namespace}.Logic.${def.id}`,
    common: {
      name: def.name,
      type: object ? "string" : output.type,
      role:
        output.type === "boolean"
          ? "level.switch"
          : object
            ? "json"
            : "level.state",
      read: true,
      write: true,
      unit: output.type === "number" ? (output.unit ?? "") : "",
      states:
        output.type === "number" ? (numberStatesOf(def) ?? {}) : {},
      def:
        output.type === "boolean"
          ? false
          : output.type === "number"
            ? 0
            : object
              ? "{}"
              : "",
    },
  };
}
