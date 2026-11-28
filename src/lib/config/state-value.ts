export type ParsedValue =
  { ok: true; value: unknown } | { ok: false; error: string };

/** The live value as text for the state editor's value field. */
export function valueText(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Parse the value field for a state type. Object/array/json must be valid JSON
 * of the right shape; mixed is JSON when it parses, otherwise plain text.
 */
export function parseValueText(text: string, type: string): ParsedValue {
  const kind = type.toLowerCase();
  if (kind === "number" || kind === "multistate") {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Enter a number." };
    const number = Number(trimmed);
    return Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false, error: "Enter a valid number." };
  }
  if (kind === "boolean") {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    return { ok: false, error: "Enter true or false." };
  }
  if (kind === "object" || kind === "array" || kind === "json") {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Enter JSON." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: "Enter valid JSON." };
    }
    if (kind === "array" && !Array.isArray(parsed)) {
      return { ok: false, error: "Enter a JSON array." };
    }
    if (
      kind === "object" &&
      (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      return { ok: false, error: "Enter a JSON object." };
    }
    return { ok: true, value: parsed };
  }
  if (kind === "mixed") {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, value: "" };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: true, value: text };
    }
  }
  return { ok: true, value: text };
}
