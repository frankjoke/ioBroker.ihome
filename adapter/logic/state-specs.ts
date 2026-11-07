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
  const mixed = output.type === "mixed";
  // A machine state is a number: the index of its state name with the names in
  // `common.states` (type `multistate`). Object/mixed machine outputs are data,
  // written only by `set("$self", …)`, so they keep their own shape.
  const indexed =
    def.kind === "machine" &&
    output.type !== "object" &&
    output.type !== "mixed";
  const numeric = indexed || output.type === "multistate";
  return {
    id: `${namespace}.Logic.${def.id}`,
    common: {
      name: def.name,
      type: numeric ? "multistate" : object ? "string" : output.type,
      role: numeric
        ? "level.state"
        : object
          ? "text.json"
          : mixed
            ? "state"
            : output.type === "boolean"
              ? "level.switch"
              : output.type === "number"
                ? (output.role ?? "level.state")
                : "text",
      read: true,
      write: true,
      unit: indexed || output.type !== "number" ? "" : (output.unit ?? ""),
      states: numeric ? (numberStatesOf(def) ?? {}) : {},
      def: numeric
        ? 0
        : output.type === "boolean"
          ? false
          : output.type === "number"
            ? 0
            : object
              ? "{}"
              : mixed
                ? null
                : "",
    },
  };
}
