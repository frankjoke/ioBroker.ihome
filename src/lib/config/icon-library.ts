// The icon library document (version 2): a curated, keyword-tagged collection
// plus the role/template defaults map. It replaces the mixed v1 pool; a v1
// document is migrated on read and written back as v2 on the next save.

import { DEVICE_TYPES } from "$lib/config/features";
import { ROLE_GLYPH_DEFAULTS, presetGlyph } from "$lib/config/icon-ops";

/** One curated icon: a symbol name, an image path or HTML/SVG markup. */
export interface LibraryIcon {
  id: string;
  /** Optional; the editor picker never shows it, the manager falls back to the value. */
  name?: string;
  value: string;
  /** The other half of an on/off twin. */
  activeValue?: string;
  /** Single lowercase words; many per icon. */
  keywords: string[];
}

/** A default is a value pair, never a reference to a library row. */
export interface IconPair {
  value: string;
  activeValue?: string;
}

export interface IconPool {
  version: 2;
  updatedAt: number;
  library: LibraryIcon[];
  defaults: {
    /** Exact role (`switch.active`) or family pattern (`light.*`). */
    roles: Record<string, IconPair>;
    /** Template id. */
    templates: Record<string, IconPair>;
  };
}

export const POOL_CAP = 500;

/** Single lowercase words from a free label (`"Door / window"` → door, window). */
export function keywordWords(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The code-defined glyphs every fresh install starts with, as library rows. */
export function seedLibrary(): LibraryIcon[] {
  const byValue = new Map<string, LibraryIcon>();
  for (const type of DEVICE_TYPES) {
    const value = presetGlyph(type);
    if (!value) continue;
    byValue.set(value, {
      id: `builtin:type:${slug(type)}`,
      name: type,
      value,
      keywords: ["device", ...keywordWords(type)],
    });
  }
  for (const role of ROLE_GLYPH_DEFAULTS) {
    const existing = byValue.get(role.glyph);
    if (existing) {
      existing.keywords = [
        ...new Set([...existing.keywords, ...keywordWords(role.name)]),
      ];
      continue;
    }
    byValue.set(role.glyph, {
      id: `builtin:role:${slug(role.name)}`,
      name: role.name,
      value: role.glyph,
      keywords: ["role", ...keywordWords(role.name)],
    });
  }
  return [...byValue.values()];
}

export function emptyIconPool(): IconPool {
  return {
    version: 2,
    updatedAt: 0,
    library: seedLibrary(),
    defaults: { roles: {}, templates: {} },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePair(raw: unknown): IconPair | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const value = text(record.value);
  if (!value) return undefined;
  const activeValue = text(record.activeValue);
  return activeValue ? { value, activeValue } : { value };
}

function parseDefaults(raw: unknown): IconPool["defaults"] {
  const defaults: IconPool["defaults"] = { roles: {}, templates: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  for (const kind of ["roles", "templates"] as const) {
    const map = record[kind];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [key, pair] of Object.entries(map as Record<string, unknown>)) {
      const parsed = parsePair(pair);
      if (key.trim() && parsed) defaults[kind][key.trim()] = parsed;
    }
  }
  return defaults;
}

function parseLibraryIcon(raw: unknown): LibraryIcon | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = text(record.id);
  const value = text(record.value);
  if (!id || !value) return undefined;
  const name = text(record.name);
  const activeValue = text(record.activeValue);
  const keywords = Array.isArray(record.keywords)
    ? [
        ...new Set(
          record.keywords.flatMap((word) => keywordWords(String(word))),
        ),
      ]
    : [];
  return {
    id,
    ...(name ? { name } : {}),
    value,
    ...(activeValue ? { activeValue } : {}),
    keywords,
  };
}

function parseLibrary(raw: unknown): LibraryIcon[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  const values = new Set<string>();
  const library: LibraryIcon[] = [];
  for (const item of raw) {
    const icon = parseLibraryIcon(item);
    if (!icon || ids.has(icon.id) || values.has(icon.value)) continue;
    ids.add(icon.id);
    values.add(icon.value);
    library.push(icon);
    if (library.length >= POOL_CAP) break;
  }
  return library;
}

function parseV2(record: Record<string, unknown>): IconPool | null {
  const library = parseLibrary(record.library);
  if (!library) return null;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return {
    version: 2,
    updatedAt,
    library,
    defaults: parseDefaults(record.defaults),
  };
}

/** v1: `icons[]` carried value, group, keywords, roles and templates together;
 *  `overrides` patched the code-defined base entries. */
function migrateV1(record: Record<string, unknown>): IconPool {
  const roles = new Map<string, IconPair>();
  const templates = new Map<string, IconPair>();
  const userRows: LibraryIcon[] = [];
  const rawIcons = Array.isArray(record.icons) ? record.icons : [];
  for (const item of rawIcons) {
    const icon = parseLibraryIcon(item);
    if (!icon) continue;
    const source = item as Record<string, unknown>;
    const group = text(source.group);
    const keywords = [
      ...new Set([...(group ? keywordWords(group) : []), ...icon.keywords]),
    ];
    userRows.push({ ...icon, keywords });
    const pair: IconPair = icon.activeValue
      ? { value: icon.value, activeValue: icon.activeValue }
      : { value: icon.value };
    // First claim wins: the two maps are only written when the key is free.
    for (const key of stringList(source.roles)) {
      if (!roles.has(key)) roles.set(key, pair);
    }
    for (const key of stringList(source.templates)) {
      if (!templates.has(key)) templates.set(key, pair);
    }
  }

  const seeds = seedLibrary();
  const overrides =
    record.overrides &&
    typeof record.overrides === "object" &&
    !Array.isArray(record.overrides)
      ? (record.overrides as Record<string, unknown>)
      : {};
  const patched = seeds.map((seed) => {
    const patch = overrides[seed.id];
    return patch && typeof patch === "object" && !Array.isArray(patch)
      ? parseOverride(seed, patch as Record<string, unknown>)
      : seed;
  });

  const ids = new Set<string>();
  const values = new Set<string>();
  const library: LibraryIcon[] = [];
  for (const icon of [...userRows, ...patched]) {
    if (ids.has(icon.id) || values.has(icon.value)) continue;
    ids.add(icon.id);
    values.add(icon.value);
    library.push(icon);
    if (library.length >= POOL_CAP) break;
  }

  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return {
    version: 2,
    updatedAt,
    library,
    defaults: {
      roles: Object.fromEntries(roles),
      templates: Object.fromEntries(templates),
    },
  };
}

function parseOverride(
  seed: LibraryIcon,
  patch: Record<string, unknown>,
): LibraryIcon {
  const value = text(patch.value);
  const activeValue = text(patch.activeValue);
  return {
    ...seed,
    ...(value ? { value } : {}),
    ...(activeValue ? { activeValue } : {}),
  };
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = text(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Parse the stored document. Null means the document is unreadable. */
export function parseIconPool(raw: unknown): IconPool | null {
  if (raw === undefined || raw === null || raw === "") return emptyIconPool();
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return emptyIconPool();
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version === 2) return parseV2(record);
  if (record.version === 1) return migrateV1(record);
  return null;
}

/** An MDI path as an inline icon that follows the resolved icon colour. */
export function mdiIconValue(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="{{$color}}"><path d="${path}"/></svg>`;
}

/** Keywords of the library with their use count, most used first. */
export function libraryKeywordCounts(
  library: LibraryIcon[],
): { keyword: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const icon of library) {
    for (const word of icon.keywords) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}

/** Every selected keyword must be present (AND); search reads keywords only. */
export function filterLibrary(
  library: LibraryIcon[],
  keywords: string[],
  search: string,
): LibraryIcon[] {
  const selected = keywords.map((word) => word.toLowerCase());
  const query = search.trim().toLowerCase();
  return library.filter(
    (icon) =>
      selected.every((word) => icon.keywords.includes(word)) &&
      (!query || icon.keywords.some((word) => word.includes(query))),
  );
}

/** Icons with an active twin first; the rest are singles. */
export function splitTwins(entries: LibraryIcon[]): {
  twins: LibraryIcon[];
  singles: LibraryIcon[];
} {
  return {
    twins: entries.filter((icon) => !!icon.activeValue),
    singles: entries.filter((icon) => !icon.activeValue),
  };
}

/** Template first, then the exact role, then its `family.*` pattern. */
export function defaultPair(
  pool: IconPool,
  templateId: string | undefined,
  role: string | undefined,
): IconPair | undefined {
  const { roles, templates } = pool.defaults;
  if (templateId && templates[templateId]) return templates[templateId];
  if (role) {
    if (roles[role]) return roles[role];
    const dot = role.indexOf(".");
    if (dot > 0) {
      const family = `${role.slice(0, dot)}.*`;
      if (roles[family]) return roles[family];
    }
  }
  return undefined;
}

export function upsertLibraryIcon(pool: IconPool, icon: LibraryIcon): IconPool {
  const exists = pool.library.some((entry) => entry.id === icon.id);
  if (!exists && pool.library.length >= POOL_CAP) return pool;
  const library = exists
    ? pool.library.map((entry) => (entry.id === icon.id ? icon : entry))
    : [...pool.library, icon];
  return { ...pool, updatedAt: Date.now(), library };
}

export function removeLibraryIcon(pool: IconPool, id: string): IconPool {
  return {
    ...pool,
    updatedAt: Date.now(),
    library: pool.library.filter((entry) => entry.id !== id),
  };
}

export function hasIconValue(library: LibraryIcon[], value: string): boolean {
  return library.some((icon) => icon.value === value);
}

/** Exact state roles and their `family.*` patterns, with use counts. */
export function roleChoicesFromObjects(
  objects: Iterable<[string, unknown]>,
): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const [, object] of objects) {
    const record = object as {
      type?: string;
      common?: { role?: string };
    } | null;
    // Only state roles can be a tile headline; channels/folders are noise.
    if (record?.type !== "state") continue;
    const role = record.common?.role;
    if (typeof role === "string" && role.trim()) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  const families = new Map<string, number>();
  for (const [role, count] of counts) {
    const dot = role.indexOf(".");
    if (dot > 0) {
      const family = `${role.slice(0, dot)}.*`;
      families.set(family, (families.get(family) ?? 0) + count);
    }
  }
  return [
    ...[...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([role, count]) => ({ value: role, label: `${role} · ${count}` })),
    ...[...families]
      .sort((a, b) => b[1] - a[1])
      .map(([family, count]) => ({
        value: family,
        label: `${family} · ${count}`,
      })),
  ];
}

/** Set or clear one default; an empty pair removes the key. */
export function setDefault(
  pool: IconPool,
  kind: "roles" | "templates",
  key: string,
  pair: IconPair | null,
): IconPool {
  const trimmed = key.trim();
  const value = pair?.value?.trim() ?? "";
  if (!trimmed) return pool;
  const defaults: IconPool["defaults"] = {
    roles: { ...pool.defaults.roles },
    templates: { ...pool.defaults.templates },
  };
  if (value) {
    const activeValue = pair?.activeValue?.trim();
    defaults[kind][trimmed] = activeValue ? { value, activeValue } : { value };
  } else {
    delete defaults[kind][trimmed];
  }
  return { ...pool, updatedAt: Date.now(), defaults };
}
