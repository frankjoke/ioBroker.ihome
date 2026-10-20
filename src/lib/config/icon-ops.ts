// The icon an ioBroker object carries, and the icon a device inherits from the
// objects behind its controls (A65). Pure: the caller passes the object map, so
// nothing here touches the socket, the DOM or a store.

export interface IconOwner {
  adapter: string;
  instance?: string;
}

/** Is this icon value an image (URL, root-relative path, broker-relative path
 *  like `adapter/name.png`) rather than a material-symbols name? (A23) */
export function isImageIcon(raw: string | undefined): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  // A symbol name is snake_case and never contains a path separator.
  if (value.includes("/")) return true;
  return /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)([?#].*)?$/i.test(value);
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

/**
 * The **portable** form of a broker icon for a document (A66): a bare filename
 * gains the adapter that owns it (`adapter/<adapter>/<file>`), which is the
 * ioBroker-root-relative path `iconSrc` later resolves against whatever host is
 * configured. Absolutes, data URIs, symbols and already-prefixed paths are left
 * alone; so is a leading `/` (a root path with nothing to prefix).
 */
export function brokerIconPath(value: string, ownerId: string): string {
  const icon = String(value ?? "").trim();
  if (!icon) return "";
  // A symbol name is not a path; absolutes, data URIs and already-prefixed
  // paths have nothing to prefix.
  if (!isImageIcon(icon)) return icon;
  if (/^(https?:)?\/\//i.test(icon) || /^data:/i.test(icon)) return icon;
  if (icon.startsWith("adapter/") || icon.startsWith("/")) return icon;
  const adapter = ownerOf(ownerId).adapter;
  return adapter ? `adapter/${adapter}/${icon}` : icon;
}
