import { DEVICE_TYPES } from "$lib/config/features";
import { ROLE_GLYPH_DEFAULTS, presetGlyph } from "$lib/config/icon-ops";

/** One icon in the user pool: the same value the picker stores in a slot. */
export interface PoolIcon {
  id: string;
  name: string;
  group?: string;
  /** Default/inactive icon. */
  value: string;
  /** Active twin; absent means a single icon. */
  activeValue?: string;
  /** Template ids this pair is the default for. */
  templates?: string[];
  /** Exact ioBroker roles and `family.*` patterns this pair defaults to. */
  roles?: string[];
  keywords?: string[];
}

/** Edits on a code-defined base entry; absent keys keep the code default. */
export interface PoolOverride {
  value?: string;
  activeValue?: string;
}

/** The document shared with the adapter and the icon manager. */
export interface IconPool {
  version: 1;
  updatedAt: number;
  /** User additions only; the base pool is code-defined. */
  icons: PoolIcon[];
  /** Base edits keyed by base entry id. */
  overrides?: Record<string, PoolOverride>;
}

/** What the picker shows: the code-defined base plus the user additions. */
export interface PoolEntry extends PoolIcon {
  builtin?: boolean;
}

export const POOL_CAP = 500;

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

const BASE_IDS = new Set(BUILTIN_POOL.map((entry) => entry.id));

function parseStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length ? out : undefined;
}

function parseOverrides(
  raw: unknown,
): Record<string, PoolOverride> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const overrides: Record<string, PoolOverride> = {};
  for (const [id, patch] of Object.entries(raw as Record<string, unknown>)) {
    if (
      !BASE_IDS.has(id) ||
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch)
    ) {
      continue;
    }
    const record = patch as Record<string, unknown>;
    const value = typeof record.value === "string" ? record.value.trim() : "";
    const activeValue =
      typeof record.activeValue === "string" ? record.activeValue.trim() : "";
    if (!value && !activeValue) continue;
    overrides[id] = {
      ...(value ? { value } : {}),
      ...(activeValue ? { activeValue } : {}),
    };
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

/** Parse the stored user document. Null means the document is unreadable. */
export function parseIconPool(raw: unknown): IconPool | null {
  if (raw === undefined || raw === null || raw === "") return emptyPool();
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return emptyPool();
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // A future document must not be silently downgraded on the next save.
  if (record.version !== undefined && record.version !== 1) return null;
  if (!Array.isArray(record.icons)) return null;
  const ids = new Set<string>();
  const icons: PoolIcon[] = [];
  for (const item of record.icons) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const iconValue = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!id || !name || !iconValue || ids.has(id)) continue;
    ids.add(id);
    const keywords = Array.isArray(entry.keywords)
      ? entry.keywords
          .filter((word): word is string => typeof word === "string")
          .map((word) => word.trim())
          .filter(Boolean)
      : undefined;
    const group = typeof entry.group === "string" ? entry.group.trim() : "";
    const activeValue =
      typeof entry.activeValue === "string" ? entry.activeValue.trim() : "";
    const templates = parseStringList(entry.templates);
    const roles = parseStringList(entry.roles);
    icons.push({
      id,
      name,
      value: iconValue,
      ...(activeValue ? { activeValue } : {}),
      ...(templates ? { templates } : {}),
      ...(roles ? { roles } : {}),
      ...(group ? { group } : {}),
      ...(keywords?.length ? { keywords } : {}),
    });
    if (icons.length >= POOL_CAP) break;
  }
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  const overrides = parseOverrides(record.overrides);
  return { version: 1, updatedAt, icons, ...(overrides ? { overrides } : {}) };
}

/** Base first (with overrides), then user additions; no repeated value. */
export function poolEntries(pool?: IconPool | null): PoolEntry[] {
  const entries = BUILTIN_POOL.map((entry) => {
    const patch = pool?.overrides?.[entry.id];
    return patch ? { ...entry, ...patch } : { ...entry };
  });
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

/**
 * The automatic pair for a tile: its template first, then the headline's exact
 * ioBroker role, then that role's `family.*` pattern. Base entries never claim
 * defaults.
 */
export function defaultPair(
  entries: PoolIcon[],
  templateId: string | undefined,
  role: string | undefined,
): PoolEntry | undefined {
  // The picker hides a user value that repeats a base glyph; automatic
  // defaults must not: the entry's template/role claim is independent.
  const user = entries.filter((entry) => !(entry as PoolEntry).builtin);
  if (templateId) {
    const byTemplate = user.find((entry) =>
      entry.templates?.includes(templateId),
    );
    if (byTemplate) return byTemplate;
  }
  if (role) {
    const exact = user.find((entry) => entry.roles?.includes(role));
    if (exact) return exact;
    const dot = role.indexOf(".");
    if (dot > 0) {
      const family = `${role.slice(0, dot)}.*`;
      const byFamily = user.find((entry) => entry.roles?.includes(family));
      if (byFamily) return byFamily;
    }
  }
  return undefined;
}

/** Add or remove one keyword; case-insensitive, and an empty list is absent. */
export function toggleKeyword(
  keywords: string[] | undefined,
  keyword: string,
): string[] | undefined {
  const word = keyword.trim();
  if (!word) return keywords;
  const list = [...(keywords ?? [])];
  const index = list.findIndex(
    (item) => item.toLowerCase() === word.toLowerCase(),
  );
  if (index >= 0) list.splice(index, 1);
  else list.push(word);
  return list.length ? list : undefined;
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

/** Set or clear fields on one base entry; unknown ids are ignored. */
export function setBaseOverride(
  pool: IconPool,
  baseId: string,
  patch: PoolOverride,
): IconPool {
  if (!BASE_IDS.has(baseId)) return pool;
  const overrides = { ...(pool.overrides ?? {}) };
  const merged: PoolOverride = { ...(overrides[baseId] ?? {}), ...patch };
  for (const key of Object.keys(merged) as (keyof PoolOverride)[]) {
    if (!merged[key]) delete merged[key];
  }
  if (Object.keys(merged).length) overrides[baseId] = merged;
  else delete overrides[baseId];
  return {
    ...pool,
    updatedAt: Date.now(),
    overrides: Object.keys(overrides).length ? overrides : undefined,
  };
}

export function clearBaseOverride(pool: IconPool, baseId: string): IconPool {
  const overrides = { ...(pool.overrides ?? {}) };
  delete overrides[baseId];
  return {
    ...pool,
    updatedAt: Date.now(),
    overrides: Object.keys(overrides).length ? overrides : undefined,
  };
}

/** An MDI path as an inline icon that follows the resolved icon colour. */
export function mdiIconValue(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="{{$color}}"><path d="${path}"/></svg>`;
}
