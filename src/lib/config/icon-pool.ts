import { DEVICE_TYPES } from "$lib/config/features";
import { ROLE_GLYPH_DEFAULTS, presetGlyph } from "$lib/config/icon-ops";

/** One icon in the user pool: the same value the picker stores in a slot. */
export interface PoolIcon {
  id: string;
  name: string;
  group?: string;
  value: string;
  keywords?: string[];
}

/** The document shared with the adapter and the icon manager. */
export interface IconPool {
  version: 1;
  updatedAt: number;
  /** User additions only; the base pool is code-defined. */
  icons: PoolIcon[];
}

/** What the picker shows: the code-defined base plus the user additions. */
export interface PoolEntry extends PoolIcon {
  builtin?: boolean;
}

const CAP = 500;

function emptyPool(): IconPool {
  return { version: 1, updatedAt: 0, icons: [] };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function baseEntries(): PoolEntry[] {
  const byValue = new Map<string, PoolEntry>();
  for (const type of DEVICE_TYPES) {
    const value = presetGlyph(type);
    if (!value) continue;
    byValue.set(value, {
      id: `builtin:type:${slug(type)}`,
      name: type,
      group: "Device types",
      value,
      keywords: ["device", type.toLowerCase()],
      builtin: true,
    });
  }
  for (const role of ROLE_GLYPH_DEFAULTS) {
    const existing = byValue.get(role.glyph);
    if (existing) {
      existing.keywords = [
        ...new Set([...(existing.keywords ?? []), role.name]),
      ];
      continue;
    }
    byValue.set(role.glyph, {
      id: `builtin:role:${slug(role.name)}`,
      name: role.name,
      group: "Roles",
      value: role.glyph,
      keywords: ["role", role.name.toLowerCase()],
      builtin: true,
    });
  }
  return [...byValue.values()];
}

/** The device-type and role defaults; never written to the config state. */
export const BUILTIN_POOL: PoolEntry[] = baseEntries();

/** Parse the stored user document. Null means the document is unreadable. */
export function parseIconPool(raw: unknown): IconPool | null {
  if (raw === undefined || raw === null || raw === "") return emptyPool();
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.icons)) return null;
  const ids = new Set<string>();
  const icons: PoolIcon[] = [];
  for (const item of record.icons) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    const iconValue = typeof entry.value === "string" ? entry.value : "";
    if (!id || !name || !iconValue || ids.has(id)) continue;
    ids.add(id);
    const keywords = Array.isArray(entry.keywords)
      ? entry.keywords.filter(
          (word): word is string => typeof word === "string",
        )
      : undefined;
    icons.push({
      id,
      name,
      value: iconValue,
      ...(typeof entry.group === "string" ? { group: entry.group } : {}),
      ...(keywords?.length ? { keywords } : {}),
    });
    if (icons.length >= CAP) break;
  }
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return { version: 1, updatedAt, icons };
}

/** A short reason the stored document cannot be edited, or null. */
export function iconPoolProblem(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (parseIconPool(raw)) return null;
  return "The icon pool document is not a readable icon list.";
}

/** Base first, then user additions; a value already present is not repeated. */
export function poolEntries(pool?: IconPool | null): PoolEntry[] {
  const entries = BUILTIN_POOL.map((entry) => ({ ...entry }));
  const seen = new Set(entries.map((entry) => entry.value));
  for (const icon of pool?.icons ?? []) {
    if (!icon.id || !icon.name || !icon.value || seen.has(icon.value)) continue;
    seen.add(icon.value);
    entries.push({ ...icon });
  }
  return entries;
}

/** Case-insensitive search over the fields people name icons by. */
export function filterPoolIcons(
  entries: PoolEntry[],
  query: string,
): PoolEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) =>
    [entry.name, entry.group ?? "", ...(entry.keywords ?? [])].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}

export function upsertPoolIcon(pool: IconPool, icon: PoolIcon): IconPool {
  const exists = pool.icons.some((entry) => entry.id === icon.id);
  const icons = exists
    ? pool.icons.map((entry) => (entry.id === icon.id ? icon : entry))
    : [...pool.icons, icon];
  return { ...pool, updatedAt: Date.now(), icons };
}

export function removePoolIcon(pool: IconPool, id: string): IconPool {
  return {
    ...pool,
    updatedAt: Date.now(),
    icons: pool.icons.filter((entry) => entry.id !== id),
  };
}

/** An MDI path as an inline icon that follows the resolved icon colour. */
export function mdiIconValue(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="{{$color}}"><path d="${path}"/></svg>`;
}
