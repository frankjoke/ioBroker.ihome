// The icon an ioBroker object carries, and the icon a device inherits from the
// objects behind its controls (A65). Pure: the caller passes the object map, so
// nothing here touches the socket, the DOM or a store.

export interface IconOwner {
  adapter: string;
  instance?: string;
}

/** The adapter (and instance) an object id belongs to (A65). */
export function ownerOf(id: string): IconOwner {
  const parts = String(id ?? "").split(".");
  if (parts[0] === "system" && parts[1] === "adapter") {
    return { adapter: parts[2] ?? "", instance: parts[3] };
  }
  return { adapter: parts[0] ?? "", instance: parts[1] };
}

const FIELDS = ["modelIcon", "extIcon", "icon"] as const;

/** The first icon field an object carries, in A65's order. */
export function objectIconValue(
  obj: unknown,
): { field: (typeof FIELDS)[number]; value: string } | undefined {
  const common = (obj as { common?: Record<string, unknown> } | undefined)
    ?.common;
  for (const field of FIELDS) {
    const value = common?.[field];
    if (typeof value === "string" && value.trim()) {
      return { field, value: value.trim() };
    }
  }
  return undefined;
}

/**
 * The icon an object id resolves to (A65): walk the id's own path upward and
 * take the nearest object that carries any icon field; with none, the adapter —
 * its instance first, then the package.
 */
export function resolveIcon(
  objects: Map<string, any>,
  id: string,
): { from: string; value: string } | undefined {
  let cur = String(id ?? "");
  while (cur) {
    const hit = objectIconValue(objects.get(cur));
    if (hit) return { from: cur, value: hit.value };
    const cut = cur.lastIndexOf(".");
    if (cut < 0) break;
    cur = cur.slice(0, cut);
  }
  const { adapter, instance } = ownerOf(id);
  if (!adapter) return undefined;
  const candidates = instance
    ? [`system.adapter.${adapter}.${instance}`, `system.adapter.${adapter}`]
    : [`system.adapter.${adapter}`];
  for (const candidate of candidates) {
    const hit = objectIconValue(objects.get(candidate));
    if (hit) return { from: candidate, value: hit.value };
  }
  return undefined;
}

/** The device's icon: the first of its controls whose reading resolves (A65). */
export function deviceObjectIcon(
  objects: Map<string, any>,
  stateIds: (string | undefined)[],
): { from: string; value: string } | undefined {
  for (const stateId of stateIds) {
    if (!stateId) continue;
    const hit = resolveIcon(objects, stateId);
    if (hit) return hit;
  }
  return undefined;
}
