/** A state object iHome wants to exist. */
export interface StateSpec {
  id: string;
  common: Record<string, unknown>;
  initial?: unknown;
}

/** A state below the adapter's own namespace may be created/updated by iHome. */
export function isOwnedState(id: string, namespace: string): boolean {
  return id.startsWith(`${namespace}.`);
}

/** `common.states` as an object; JSON strings are accepted. */
export function normalizeStates(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value === "string") {
    try {
      return normalizeStates(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, string>;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sorted((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(sorted(value));
}

/**
 * The owned `common` keys that differ, or null when everything matches.
 * Only keys present in `desired` are compared; extra existing keys stay.
 */
export function stateCommonDiff(
  existing: Record<string, unknown> | undefined,
  desired: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!existing) return desired;
  const diff: Record<string, unknown> = {};
  for (const [key, want] of Object.entries(desired)) {
    const have = existing[key];
    const same =
      key === "states"
        ? canonical(normalizeStates(have)) === canonical(normalizeStates(want))
        : key === "def"
          ? canonical(have) === canonical(want)
          : Object.is(have, want);
    if (!same) diff[key] = want;
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

/** A full object whose common replaces the changed keys (no deep merge). */
export function stateObjectWithDiff(
  existing: Record<string, unknown>,
  diff: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    common: { ...(existing.common as Record<string, unknown>), ...diff },
  };
}
