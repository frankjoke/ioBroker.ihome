/**
 * Derive a sensible default unit/label for a control from its ioBroker object.
 * Precedence: explicit unit → states list → boolean ON/OFF → number range.
 */
export function defaultUnit(obj: any): string {
  const c = obj?.common ?? {};
  if (c.unit) return String(c.unit);

  if (c.states) {
    const labels = Array.isArray(c.states)
      ? c.states.map((label: any, i: number) => `${i}: ${String(label)}`)
      : Object.entries(c.states).map(
          ([value, label]) => `${value}: ${String(label)}`,
        );
    if (labels.length) return `(${labels.join(", ")})`;
  }

  if (c.type === "boolean") return "OFF/ON";

  if (c.type === "number" && (c.min !== undefined || c.max !== undefined)) {
    return `Number (${c.min ?? ""}-${c.max ?? ""})`;
  }

  return "";
}
