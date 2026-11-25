// Shared, browser-safe contract for overrides stored next to a state:
// `common.custom.ihome = { version: 1, overrides: [...] }`.
// The adapter mirrors the SPA's override list here; the SPA reads it back.

export const OVERRIDE_CUSTOM_KEY = "ihome";
export const OVERRIDE_CUSTOM_VERSION = 1;

/** The override list of one iHome instance. */
export function overrideListId(instance: string): string {
  return `${instance}.config.overrideList`;
}

/** One override as it travels on a state object (structurally SourceOverride). */
export interface CustomOverride {
  id: string;
  stateId: string;
  kind: "repair" | "derived";
  name: string;
  [key: string]: unknown;
}

export interface CustomOverrideEntry {
  version: 1;
  /** `updatedAt` of the override list this entry mirrors. */
  updatedAt: number;
  overrides: CustomOverride[];
}

export interface OverrideDocument {
  overrides: CustomOverride[];
  updatedAt: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalize(value: unknown): CustomOverride | null {
  if (!record(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const stateId = typeof value.stateId === "string" ? value.stateId.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!id || !stateId || !name) return null;
  if (value.kind !== "repair" && value.kind !== "derived") return null;
  return { ...value, id, stateId, name, kind: value.kind };
}

/** The overrides and timestamp of a saved list document. */
export function parseOverrideDocument(value: unknown): OverrideDocument | null {
  let parsed = value;
  if (typeof parsed === "string") parsed = parseJson(parsed);
  if (record(parsed) && "val" in parsed) {
    parsed = parsed.val;
    if (typeof parsed === "string") parsed = parseJson(parsed);
  }
  if (!record(parsed) || !Array.isArray(parsed.overrides)) return null;
  if (parsed.version !== undefined && parsed.version !== 1) return null;
  return {
    overrides: parsed.overrides
      .map(normalize)
      .filter((entry): entry is CustomOverride => entry !== null),
    updatedAt:
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : 0,
  };
}

/** The overrides of a saved list document, or null when unusable. */
export function parseOverrideList(value: unknown): CustomOverride[] | null {
  return parseOverrideDocument(value)?.overrides ?? null;
}

/** The valid overrides attached to a state object; [] when none. */
export function customOverridesOf(object: unknown): CustomOverride[] {
  return customEntryOf(object)?.overrides ?? [];
}

/** The versioned entry on a state object, with its mirror timestamp. */
export function customEntryOf(object: unknown): CustomOverrideEntry | null {
  if (!record(object) || !record(object.common)) return null;
  const custom = record(object.common.custom) ? object.common.custom : null;
  const entry =
    custom && record(custom[OVERRIDE_CUSTOM_KEY])
      ? custom[OVERRIDE_CUSTOM_KEY]
      : null;
  if (
    !entry ||
    entry.version !== OVERRIDE_CUSTOM_VERSION ||
    !Array.isArray(entry.overrides)
  ) {
    return null;
  }
  return {
    version: 1,
    updatedAt:
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : 0,
    overrides: entry.overrides
      .map(normalize)
      .filter((value): value is CustomOverride => value !== null),
  };
}

/** A custom record with this state's overrides; other keys are preserved. */
export function withCustomOverrides(
  custom: unknown,
  overrides: CustomOverride[],
  updatedAt = 0,
): Record<string, unknown> {
  const next = record(custom) ? { ...custom } : {};
  if (overrides.length > 0) {
    next[OVERRIDE_CUSTOM_KEY] = {
      version: OVERRIDE_CUSTOM_VERSION,
      updatedAt,
      overrides,
    };
  } else {
    delete next[OVERRIDE_CUSTOM_KEY];
  }
  return next;
}
