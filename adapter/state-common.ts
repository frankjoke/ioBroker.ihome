const STATE_TYPES = [
  "boolean",
  "number",
  "string",
  "mixed",
  "object",
  "array",
  "json",
] as const;

const TEXT_KEYS = ["name", "role", "unit", "desc"] as const;
const NUMBER_KEYS = ["min", "max", "step"] as const;
const BOOLEAN_KEYS = ["read", "write"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Why an editable common patch cannot be written, or null when it can. */
export function commonProblem(value: unknown): string | null {
  if (!record(value)) return "State settings must be a JSON object.";
  if ("name" in value) {
    if (typeof value.name !== "string" || !value.name.trim()) {
      return "The state name must not be empty.";
    }
  }
  for (const key of TEXT_KEYS) {
    if (key !== "name" && key in value && typeof value[key] !== "string") {
      return `The state ${key} must be text.`;
    }
  }
  if (
    "type" in value &&
    (typeof value.type !== "string" ||
      !(STATE_TYPES as readonly string[]).includes(value.type))
  ) {
    return `The state type must be one of ${STATE_TYPES.join(", ")}.`;
  }
  for (const key of NUMBER_KEYS) {
    if (!(key in value)) continue;
    const number = value[key];
    if (
      number !== null &&
      (typeof number !== "number" || !Number.isFinite(number))
    ) {
      return `The state ${key} must be a number or null.`;
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (key in value && typeof value[key] !== "boolean") {
      return `The state ${key} flag must be true or false.`;
    }
  }
  return null;
}

/** The settable projection of a state object with the editable common fields
 *  patched in; every other common field (custom included) is kept. */
export function settableCommonObject(
  object: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const common = record(object.common) ? { ...object.common } : {};
  if (typeof patch.name === "string") common.name = patch.name.trim();
  for (const key of ["role", "unit", "desc"] as const) {
    if (key in patch) common[key] = patch[key];
  }
  if (typeof patch.type === "string") common.type = patch.type;
  for (const key of NUMBER_KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === null || patch[key] === undefined) delete common[key];
    else common[key] = patch[key];
  }
  for (const key of BOOLEAN_KEYS) {
    if (key in patch) common[key] = patch[key];
  }
  return {
    ...(object.type !== undefined ? { type: object.type } : {}),
    ...(record(object.native) ? { native: object.native } : {}),
    common,
  };
}
