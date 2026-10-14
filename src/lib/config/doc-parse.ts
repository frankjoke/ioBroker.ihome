/**
 * Reading a persisted document back out of an ioBroker state: the value may
 * arrive as the state object (`{ val }`), as a JSON string, or as the plain
 * object. Invalid input returns `null` so the caller keeps whatever it already
 * has in memory instead of wiping the user's config.
 */

export function unwrapDoc(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "val" in (raw as Record<string, unknown>)
  ) {
    return (raw as { val: unknown }).val;
  }
  return raw;
}

export function parseDoc<T>(
  raw: unknown,
  shape: (value: Record<string, unknown>) => T | null,
): T | null {
  let value = unwrapDoc(raw);
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return shape(value as Record<string, unknown>);
}

/** Shared by every document parse: numbers with a fallback. */
export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
