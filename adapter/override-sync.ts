import {
  OVERRIDE_CUSTOM_KEY,
  customOverridesOf,
  withCustomOverrides,
  type CustomOverride,
} from "./override-common";

/** The object surface the sync needs; the adapter supplies foreign objects. */
export interface OverrideObjectHost {
  getObject(id: string): Promise<Record<string, unknown> | null | undefined>;
  setObject(id: string, object: Record<string, unknown>): Promise<unknown>;
}

export interface OverrideSyncResult {
  updated: number;
  removed: number;
  skipped: number;
  failed: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A state's overrides, grouped and in list order. */
export function groupOverrides(
  overrides: CustomOverride[],
): Map<string, CustomOverride[]> {
  const groups = new Map<string, CustomOverride[]>();
  for (const override of overrides) {
    const group = groups.get(override.stateId);
    if (group) group.push(override);
    else groups.set(override.stateId, [override]);
  }
  return groups;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Compare two groups without letting object key order produce a write. */
export function sameOverrideGroup(
  a: CustomOverride[],
  b: CustomOverride[],
): boolean {
  const order = (group: CustomOverride[]) =>
    [...group].sort((left, right) => left.id.localeCompare(right.id));
  return canonical(order(a)) === canonical(order(b));
}

function customOf(object: Record<string, unknown>): Record<string, unknown> {
  const common = record(object.common) ? object.common : {};
  return record(common.custom) ? { ...common.custom } : {};
}

function withCustom(
  object: Record<string, unknown>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const common = record(object.common) ? object.common : {};
  return { ...object, common: { ...common, custom } };
}

/**
 * Mirror the current list onto state objects and remove entries that left the
 * list. Every write is a full read-modify-write so other adapters' custom keys
 * and every other object field survive.
 */
export async function syncOverrideObjects(
  host: OverrideObjectHost,
  next: CustomOverride[],
  previous: CustomOverride[] = [],
): Promise<OverrideSyncResult> {
  const result: OverrideSyncResult = {
    updated: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  const nextGroups = groupOverrides(next);
  const previousGroups = groupOverrides(previous);
  const nextIds = new Set(next.map((override) => override.id));
  const removedIds = new Set(
    previous
      .filter((override) => !nextIds.has(override.id))
      .map((override) => override.id),
  );

  for (const [stateId, overrides] of nextGroups) {
    const object = await host.getObject(stateId);
    if (!object) {
      result.skipped += 1;
      continue;
    }
    const existing = customOverridesOf(object);
    const kept = existing.filter((override) => !removedIds.has(override.id));
    const merged = new Map(kept.map((override) => [override.id, override]));
    for (const override of overrides) merged.set(override.id, override);
    const group = [...merged.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (sameOverrideGroup(existing, group)) continue;
    try {
      await host.setObject(
        stateId,
        withCustom(object, withCustomOverrides(customOf(object), group)),
      );
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }

  for (const stateId of previousGroups.keys()) {
    if (nextGroups.has(stateId)) continue;
    const object = await host.getObject(stateId);
    if (!object) {
      result.skipped += 1;
      continue;
    }
    const existing = customOverridesOf(object);
    if (existing.length === 0) continue;
    const kept = existing.filter((override) => !removedIds.has(override.id));
    if (sameOverrideGroup(existing, kept)) continue;
    const custom = withCustomOverrides(customOf(object), kept);
    if (kept.length === 0) {
      // ioBroker's object merge keeps a missing nested key; null removes the
      // value for our reader while other custom keys stay untouched.
      custom[OVERRIDE_CUSTOM_KEY] = null;
    }
    try {
      await host.setObject(stateId, withCustom(object, custom));
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

/** Read the object metadata for one state; [] when absent. */
export async function readStateOverrides(
  host: Pick<OverrideObjectHost, "getObject">,
  stateId: string,
): Promise<CustomOverride[]> {
  const object = await host.getObject(stateId);
  return object ? customOverridesOf(object) : [];
}
