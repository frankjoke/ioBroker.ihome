const MAX_CUSTOM = 64 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Why a custom payload cannot be written, or null when it can. */
export function customProblem(value: unknown): string | null {
  if (!record(value)) return "Custom settings must be a JSON object.";
  if (JSON.stringify(value).length > MAX_CUSTOM) {
    return "Custom settings are too large.";
  }
  return null;
}

/** The settable projection of a state object with a replaced custom record.
 *  The object db keeps old `common.custom` keys unless they are null, so a key
 *  the page dropped is sent as null for the db to delete it. */
export function settableCustomObject(
  object: Record<string, unknown>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const common = record(object.common) ? object.common : {};
  const previous = record(common.custom) ? common.custom : {};
  const next: Record<string, unknown> = { ...custom };
  for (const key of Object.keys(previous)) {
    if (!(key in next)) next[key] = null;
  }
  return {
    ...(object.type !== undefined ? { type: object.type } : {}),
    ...(record(object.native) ? { native: object.native } : {}),
    common: { ...common, custom: next },
  };
}
