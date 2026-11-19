import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";

/** The config document every override lives in. */
export const OVERRIDE_LIST_ID = "ihome.0.config.overrideList";

export function emptyOverrideRegistry(): OverrideRegistry {
  return { version: 1, updatedAt: 0, overrides: [] };
}

/** One stored entry, or null when it cannot be a usable override. */
function normalizeOverride(value: unknown): SourceOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const stateId = typeof raw.stateId === "string" ? raw.stateId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const kind =
    raw.kind === "repair" || raw.kind === "derived" ? raw.kind : null;
  if (!id || !stateId || !name || !kind) return null;
  // Unknown optional fields are kept: a newer iHome may have written them.
  return { ...raw, id, stateId, name, kind } as SourceOverride;
}

/**
 * Arbitrary persisted data as a registry, or null when the document is
 * unreadable (the UI then stays read-only and never overwrites it).
 */
export function normalizeOverrideRegistry(
  value: unknown,
): OverrideRegistry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  if (!Array.isArray(doc.overrides)) return null;
  const overrides = doc.overrides
    .map(normalizeOverride)
    .filter((o): o is SourceOverride => o !== null);
  // A non-empty list that loses every entry is corrupt, not an empty registry.
  if (doc.overrides.length > 0 && overrides.length === 0) return null;
  return {
    version: 1,
    updatedAt:
      typeof doc.updatedAt === "number" && Number.isFinite(doc.updatedAt)
        ? doc.updatedAt
        : 0,
    ...(doc.migratedDevices === true ? { migratedDevices: true } : {}),
    overrides,
  };
}

export function overrideById(
  reg: OverrideRegistry,
  id: string,
): SourceOverride | undefined {
  return reg.overrides.find((o) => o.id === id);
}

export function overridesForState(
  reg: OverrideRegistry,
  stateId: string,
): SourceOverride[] {
  return reg.overrides.filter((o) => o.stateId === stateId);
}

/** Name uniqueness applies per state, case-insensitive. */
export function overrideNameTaken(
  reg: OverrideRegistry,
  stateId: string,
  name: string,
  exceptId?: string,
): boolean {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  return reg.overrides.some(
    (o) =>
      o.id !== exceptId &&
      o.stateId === stateId &&
      o.name.trim().toLowerCase() === key,
  );
}

/** Replace by id, append otherwise; `updatedAt` belongs to the store. */
export function upsertOverride(
  reg: OverrideRegistry,
  override: SourceOverride,
): OverrideRegistry {
  const exists = reg.overrides.some((o) => o.id === override.id);
  return {
    ...reg,
    overrides: exists
      ? reg.overrides.map((o) => (o.id === override.id ? override : o))
      : [...reg.overrides, override],
  };
}

export function removeOverride(
  reg: OverrideRegistry,
  id: string,
): OverrideRegistry {
  return { ...reg, overrides: reg.overrides.filter((o) => o.id !== id) };
}
