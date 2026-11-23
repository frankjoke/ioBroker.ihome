import {
  OVERRIDE_CUSTOM_KEY,
  customEntryOf,
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

export interface OverrideSyncOptions {
  /** `updatedAt` of the list being mirrored; 0 means the list is unknown. */
  updatedAt?: number;
  /** Resolve a variable-named state id to the concrete broker state id. */
  resolveStateId?: (stateId: string) => string | undefined;
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
  return {
    ...(object.type !== undefined ? { type: object.type } : {}),
    ...(record(object.native) ? { native: object.native } : {}),
    common: { ...common, custom },
  };
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
  options: OverrideSyncOptions = {},
): Promise<OverrideSyncResult> {
  const result: OverrideSyncResult = {
    updated: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  const listUpdatedAt = options.updatedAt ?? 0;
  const resolve = (override: CustomOverride): CustomOverride => {
    const stateId =
      options.resolveStateId?.(override.stateId) ?? override.stateId;
    return stateId === override.stateId ? override : { ...override, stateId };
  };
  const current = next.map(resolve);
  const prior = previous.map(resolve);
  const nextGroups = groupOverrides(current);
  const previousGroups = groupOverrides(prior);

  for (const [stateId, overrides] of nextGroups) {
    let object: Record<string, unknown> | null | undefined;
    try {
      object = await host.getObject(stateId);
    } catch {
      result.failed += 1;
      continue;
    }
    if (!object || (object.type !== undefined && object.type !== "state")) {
      result.skipped += 1;
      continue;
    }
    const entry = customEntryOf(object);
    // A newer object (or a lost list) wins: do not regress its metadata.
    if (entry && (listUpdatedAt === 0 || entry.updatedAt > listUpdatedAt)) {
      continue;
    }
    const group = [...overrides].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (
      entry &&
      entry.updatedAt === listUpdatedAt &&
      sameOverrideGroup(entry.overrides, group)
    ) {
      continue;
    }
    try {
      await host.setObject(
        stateId,
        withCustom(
          object,
          withCustomOverrides(customOf(object), group, listUpdatedAt),
        ),
      );
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }

  for (const stateId of previousGroups.keys()) {
    if (nextGroups.has(stateId)) continue;
    let object: Record<string, unknown> | null | undefined;
    try {
      object = await host.getObject(stateId);
    } catch {
      result.failed += 1;
      continue;
    }
    if (!object || (object.type !== undefined && object.type !== "state")) {
      result.skipped += 1;
      continue;
    }
    const entry = customEntryOf(object);
    if (!entry || listUpdatedAt === 0 || entry.updatedAt > listUpdatedAt) {
      continue;
    }
    try {
      const custom = withCustomOverrides(customOf(object), [], listUpdatedAt);
      // The object merge keeps a missing nested key; null is the tombstone.
      custom[OVERRIDE_CUSTOM_KEY] = null;
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
