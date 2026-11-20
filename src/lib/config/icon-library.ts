// The icon library document. Version 3 splits the two jobs cleanly: the
// library lists single icons, and a pairing is one relation between two values.
// Every reader that cares about on/off reads `twins`; nothing else does.

import { DEVICE_TYPES } from "$lib/config/features";
import { ROLE_GLYPH_DEFAULTS, presetGlyph } from "$lib/config/icon-ops";
import { newId } from "$lib/utils/ids";

/** One curated icon: a symbol name, an image path or HTML/SVG markup. */
export interface LibraryIcon {
  id: string;
  /** Optional; the editor picker never shows it, the manager falls back to the value. */
  name?: string;
  value: string;
  /** Single lowercase words; many per icon. */
  keywords: string[];
}

/** A resolved pair: the icon plus its active twin, looked up in `twins`. */
export interface IconPair {
  value: string;
  activeValue?: string;
}

export type DefaultKind = "roles" | "templates";

export interface IconPool {
  version: 3;
  updatedAt: number;
  library: LibraryIcon[];
  /** off value → on value; one pairing per value, global. */
  twins: Record<string, string>;
  defaults: {
    /** Exact role (`switch.active`) or family pattern (`light.*`) → value. */
    roles: Record<string, string>;
    /** Template id → value. */
    templates: Record<string, string>;
  };
  /** Built-in seed already applied (see `ensureBuiltinDefaults`). */
  builtin?: number;
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
    version: 3,
    updatedAt: 0,
    library: seedLibrary(),
    twins: {},
    defaults: { roles: {}, templates: {} },
  };
}

// ------------------------------------------------------------ built-in seed

export const BUILTIN_SEED_VERSION = 1;

const builtinIcon = (file: string): string => `/ihome/icons/builtin/${file}`;

/** Shipped icons, added to the library once; they also dress roles/templates. */
export const BUILTIN_ICONS: {
  value: string;
  name: string;
  keywords: string[];
}[] = [
  {
    value: builtinIcon("light-off.svg"),
    name: "Light off",
    keywords: ["light", "lamp", "off"],
  },
  {
    value: builtinIcon("light-on.svg"),
    name: "Light on",
    keywords: ["light", "lamp", "on"],
  },
  {
    value: builtinIcon("switch-off.svg"),
    name: "Switch off",
    keywords: ["switch", "plug", "off"],
  },
  {
    value: builtinIcon("switch-on.svg"),
    name: "Switch on",
    keywords: ["switch", "plug", "on"],
  },
  {
    value: builtinIcon("ac-off.svg"),
    name: "Air condition off",
    keywords: ["ac", "air", "climate", "off"],
  },
  {
    value: builtinIcon("ac-on.svg"),
    name: "Air condition on",
    keywords: ["ac", "air", "climate", "on"],
  },
  {
    value: builtinIcon("motion-off.svg"),
    name: "Motion off",
    keywords: ["motion", "presence", "off"],
  },
  {
    value: builtinIcon("motion-on.svg"),
    name: "Motion on",
    keywords: ["motion", "presence", "on"],
  },
  {
    value: builtinIcon("alarm-off.svg"),
    name: "Alarm off",
    keywords: ["alarm", "fire", "flood", "off"],
  },
  {
    value: builtinIcon("alarm-on.svg"),
    name: "Alarm on",
    keywords: ["alarm", "fire", "flood", "on"],
  },
  {
    value: builtinIcon("temperature.svg"),
    name: "Temperature",
    keywords: ["temperature", "climate"],
  },
  {
    value: builtinIcon("humidity.svg"),
    name: "Humidity",
    keywords: ["humidity", "water"],
  },
  {
    value: builtinIcon("power.svg"),
    name: "Power",
    keywords: ["power", "energy"],
  },
  {
    value: builtinIcon("battery.svg"),
    name: "Battery",
    keywords: ["battery", "charge"],
  },
  {
    value: builtinIcon("button.svg"),
    name: "Button",
    keywords: ["button", "press"],
  },
];

export const BUILTIN_TWINS: Record<string, string> = {
  [builtinIcon("light-off.svg")]: builtinIcon("light-on.svg"),
  [builtinIcon("switch-off.svg")]: builtinIcon("switch-on.svg"),
  [builtinIcon("ac-off.svg")]: builtinIcon("ac-on.svg"),
  [builtinIcon("motion-off.svg")]: builtinIcon("motion-on.svg"),
  [builtinIcon("alarm-off.svg")]: builtinIcon("alarm-on.svg"),
};

export const BUILTIN_DEFAULTS: {
  roles: Record<string, string>;
  templates: Record<string, string>;
} = {
  roles: {
    "switch.light": builtinIcon("light-off.svg"),
    switch: builtinIcon("switch-off.svg"),
    "switch.power": builtinIcon("ac-off.svg"),
    "sensor.motion": builtinIcon("motion-off.svg"),
    "sensor.alarm": builtinIcon("alarm-off.svg"),
    "sensor.alarm.fire": builtinIcon("alarm-off.svg"),
    "sensor.alarm.flood": builtinIcon("alarm-off.svg"),
    "sensor.alarm.co": builtinIcon("alarm-off.svg"),
    "value.temperature": builtinIcon("temperature.svg"),
    "level.temperature": builtinIcon("temperature.svg"),
    "value.humidity": builtinIcon("humidity.svg"),
    "level.humidity": builtinIcon("humidity.svg"),
    "value.power": builtinIcon("power.svg"),
    "value.battery": builtinIcon("battery.svg"),
    button: builtinIcon("button.svg"),
  },
  templates: { AC: builtinIcon("ac-off.svg") },
};

/** The pool as it is written: keywords normalized, everything else kept —
 *  including the built-in marker, or the next load would seed again. */
export function normalizeIconPool(pool: IconPool): IconPool {
  return {
    version: 3,
    updatedAt: pool.updatedAt,
    ...(typeof pool.builtin === "number" ? { builtin: pool.builtin } : {}),
    twins: pool.twins,
    library: pool.library.map((icon) => {
      const keywords = [
        ...new Set(icon.keywords.flatMap((word) => keywordWords(word))),
      ];
      const name = icon.name?.trim();
      return {
        id: icon.id,
        ...(name ? { name } : {}),
        value: icon.value.trim(),
        keywords,
      };
    }),
    defaults: pool.defaults,
  };
}

/** Add the shipped rows, pairs and defaults once; anything the user set wins. */
export function ensureBuiltinDefaults(pool: IconPool): IconPool {
  if (pool.builtin === BUILTIN_SEED_VERSION) return pool;
  const library = [...pool.library];
  for (const icon of BUILTIN_ICONS) {
    if (!library.some((entry) => entry.value === icon.value)) {
      library.push({ id: `builtin:icon:${slug(icon.value)}`, ...icon });
    }
  }
  const twins = { ...pool.twins };
  for (const [off, on] of Object.entries(BUILTIN_TWINS)) {
    if (twins[off] || Object.values(twins).includes(on)) continue;
    twins[off] = on;
  }
  return {
    ...pool,
    builtin: BUILTIN_SEED_VERSION,
    library,
    twins,
    defaults: {
      roles: { ...BUILTIN_DEFAULTS.roles, ...pool.defaults.roles },
      templates: { ...BUILTIN_DEFAULTS.templates, ...pool.defaults.templates },
    },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.flatMap((word) => keywordWords(String(word))))];
}

function parseLibraryIcon(raw: unknown): LibraryIcon | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = text(record.id);
  const value = text(record.value);
  if (!id || !value) return undefined;
  const name = text(record.name);
  return {
    id,
    ...(name ? { name } : {}),
    value,
    keywords: parseKeywords(record.keywords),
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

function parseTwins(raw: unknown): Record<string, string> {
  const twins: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return twins;
  for (const [off, on] of Object.entries(raw as Record<string, unknown>)) {
    const key = off.trim();
    const value = text(on);
    if (key && value && key !== value) twins[key] = value;
  }
  return twins;
}

function parseDefaults(raw: unknown): IconPool["defaults"] {
  const defaults: IconPool["defaults"] = { roles: {}, templates: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  for (const kind of ["roles", "templates"] as const) {
    const map = record[kind];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
      const trimmed = key.trim();
      const icon = text(value);
      if (trimmed && icon) defaults[kind][trimmed] = icon;
    }
  }
  return defaults;
}

function parseV3(record: Record<string, unknown>): IconPool | null {
  const library = parseLibrary(record.library);
  if (!library) return null;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return {
    version: 3,
    updatedAt,
    library,
    twins: parseTwins(record.twins),
    defaults: parseDefaults(record.defaults),
    ...(typeof record.builtin === "number" ? { builtin: record.builtin } : {}),
  };
}

/** v2 rows carried `activeValue` next to `value`; defaults carried pairs. */
interface LibraryIconV2 extends LibraryIcon {
  activeValue?: string;
}

function libraryV2(raw: unknown): LibraryIconV2[] {
  if (!Array.isArray(raw)) return [];
  const rows: LibraryIconV2[] = [];
  for (const item of raw) {
    const icon = parseLibraryIcon(item);
    if (!icon) continue;
    const active = text((item as Record<string, unknown>).activeValue);
    rows.push({ ...icon, ...(active ? { activeValue: active } : {}) });
  }
  return rows;
}

function defaultsV2(raw: unknown): {
  roles: Record<string, IconPair>;
  templates: Record<string, IconPair>;
} {
  const defaults: {
    roles: Record<string, IconPair>;
    templates: Record<string, IconPair>;
  } = { roles: {}, templates: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  for (const kind of ["roles", "templates"] as const) {
    const map = record[kind];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const [key, pair] of Object.entries(map as Record<string, unknown>)) {
      if (!pair || typeof pair !== "object" || Array.isArray(pair)) continue;
      const value = text((pair as Record<string, unknown>).value);
      const activeValue = text((pair as Record<string, unknown>).activeValue);
      if (key.trim() && value) {
        defaults[kind][key.trim()] = activeValue
          ? { value, activeValue }
          : { value };
      }
    }
  }
  return defaults;
}

/** Build v3 from v2-shaped material: split pairs into rows + `twins`. */
function buildV3(
  rows: LibraryIconV2[],
  defaults: {
    roles: Record<string, IconPair>;
    templates: Record<string, IconPair>;
  },
  updatedAt: number,
): IconPool {
  const library: LibraryIcon[] = [];
  const ids = new Set<string>();
  const values = new Set<string>();
  const twins: Record<string, string> = {};

  const addRow = (row: LibraryIcon): void => {
    if (!row.value || ids.has(row.id) || values.has(row.value)) return;
    if (library.length >= POOL_CAP) return;
    ids.add(row.id);
    values.add(row.value);
    library.push(row);
  };
  const addTwin = (off: string, on: string): void => {
    if (!off || !on || off === on) return;
    twins[off] = on;
    // Both halves are icons in the library; list the on-half when the pair
    // introduces it.
    if (!values.has(on)) {
      addRow({
        id: `twin:${slug(on)}`,
        value: on,
        keywords: keywordWords(on),
      });
    }
  };

  for (const row of rows) {
    const { activeValue, ...icon } = row;
    addRow(icon);
    if (activeValue) addTwin(icon.value, activeValue);
  }

  const outDefaults: IconPool["defaults"] = { roles: {}, templates: {} };
  for (const kind of ["roles", "templates"] as const) {
    for (const [key, pair] of Object.entries(defaults[kind])) {
      outDefaults[kind][key] = pair.value;
      if (pair.activeValue) addTwin(pair.value, pair.activeValue);
    }
  }

  return { version: 3, updatedAt, library, twins, defaults: outDefaults };
}

/** v1: user icons carried group, keywords, roles, templates and activeValue. */
function migrateV1(
  record: Record<string, unknown>,
  updatedAt: number,
): IconPool | null {
  const rawIcons = record.icons;
  // A v1 document without an icons array is malformed; it must stay
  // unreadable rather than be replaced by the seed and overwritten.
  if (!Array.isArray(rawIcons)) return null;
  const roles = new Map<string, IconPair>();
  const templates = new Map<string, IconPair>();
  const userRows: LibraryIconV2[] = [];
  for (const item of rawIcons) {
    const icon = parseLibraryIcon(item);
    if (!icon) continue;
    const source = item as Record<string, unknown>;
    const group = text(source.group);
    const keywords = [
      ...new Set([...(group ? keywordWords(group) : []), ...icon.keywords]),
    ];
    const activeValue = text(source.activeValue);
    userRows.push({
      ...icon,
      keywords,
      ...(activeValue ? { activeValue } : {}),
    });
    const pair: IconPair = activeValue
      ? { value: icon.value, activeValue }
      : { value: icon.value };
    // First claim wins: the maps are only written when the key is free.
    for (const key of stringList(source.roles)) {
      if (!roles.has(key)) roles.set(key, pair);
    }
    for (const key of stringList(source.templates)) {
      if (!templates.has(key)) templates.set(key, pair);
    }
  }

  const overrides =
    record.overrides &&
    typeof record.overrides === "object" &&
    !Array.isArray(record.overrides)
      ? (record.overrides as Record<string, unknown>)
      : {};
  const seeds = seedLibrary().map((seed) => {
    const patch = overrides[seed.id];
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      return seed;
    const value = text((patch as Record<string, unknown>).value);
    const activeValue = text((patch as Record<string, unknown>).activeValue);
    return {
      ...seed,
      ...(value ? { value } : {}),
      ...(activeValue ? { activeValue } : {}),
    };
  });

  const ids = new Set<string>();
  const values = new Set<string>();
  const rows: LibraryIconV2[] = [];
  for (const row of [...userRows, ...seeds]) {
    if (ids.has(row.id) || values.has(row.value)) continue;
    ids.add(row.id);
    values.add(row.value);
    rows.push(row);
    if (rows.length >= POOL_CAP) break;
  }

  return buildV3(
    rows,
    {
      roles: Object.fromEntries(roles),
      templates: Object.fromEntries(templates),
    },
    updatedAt,
  );
}

/** v2: library rows may carry `activeValue`, defaults carry pairs. */
function upgradeV2(record: Record<string, unknown>): IconPool | null {
  if (!Array.isArray(record.library)) return null;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return buildV3(
    libraryV2(record.library),
    defaultsV2(record.defaults),
    updatedAt,
  );
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
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  if (record.version === 3) return parseV3(record);
  if (record.version === 2) return upgradeV2(record);
  if (record.version === 1) return migrateV1(record, updatedAt);
  return null;
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

/** Manager search: name, value and keywords (the picker shows no names). */
export function filterLibraryNames(
  library: LibraryIcon[],
  search: string,
): LibraryIcon[] {
  const query = search.trim().toLowerCase();
  if (!query) return library;
  return library.filter(
    (icon) =>
      (icon.name ?? "").toLowerCase().includes(query) ||
      icon.value.toLowerCase().includes(query) ||
      icon.keywords.some((word) => word.includes(query)),
  );
}

/** The on half of a twin, when `value` is its off half. */
export function onTwin(
  twins: Record<string, string>,
  value: string,
): string | undefined {
  return twins[value];
}

/** The off half of a twin, when `value` is its on half. */
export function offTwin(
  twins: Record<string, string>,
  value: string,
): string | undefined {
  return Object.keys(twins).find((off) => twins[off] === value);
}

/** A suggested off/on pair for an unpaired icon, from its naming pattern. */
export interface TwinSuggestion {
  off: string;
  on: string;
}

const TWIN_SUFFIXES: Array<[string, string]> = [
  ["_off", "_on"],
  ["-off", "-on"],
  ["_outline", "_filled"],
  ["-outline", "-filled"],
  ["_open", "_closed"],
  ["-open", "-closed"],
];

/**
 * The pair an icon manager can offer for `value`: the existing relation first,
 * then a counterpart with the opposite naming suffix. A counterpart already
 * paired with another icon is not suggested.
 */
export function suggestTwin(
  pool: IconPool,
  value: string,
): TwinSuggestion | undefined {
  const existing = pool.twins[value];
  if (existing) return { off: value, on: existing };
  const otherOff = offTwin(pool.twins, value);
  if (otherOff) return { off: otherOff, on: value };
  const lower = value.toLowerCase();
  const counterpart = (candidate: string): string | undefined =>
    pool.library.find((icon) => icon.value.toLowerCase() === candidate)?.value;
  const paired = (v: string): boolean =>
    pool.twins[v] !== undefined || offTwin(pool.twins, v) !== undefined;
  for (const [offSuffix, onSuffix] of TWIN_SUFFIXES) {
    if (lower.endsWith(offSuffix)) {
      const on = counterpart(value.slice(0, -offSuffix.length) + onSuffix);
      if (!on || paired(on)) continue;
      return { off: value, on };
    }
    if (lower.endsWith(onSuffix)) {
      const off = counterpart(value.slice(0, -onSuffix.length) + offSuffix);
      if (!off || paired(off)) continue;
      return { off, on: value };
    }
  }
  return undefined;
}

/** What clicking a pair row offers: one pair target, or two single targets. */
export interface IconPickChoice {
  value: string;
  active?: string;
}

export function pairChoices(
  off: string,
  on: string | undefined,
  pairAware: boolean,
): IconPickChoice[] {
  if (!on) return [{ value: off }];
  return pairAware
    ? [{ value: off, active: on }]
    : [{ value: off }, { value: on }];
}

/** Paired icons first for the twin-aware picker; a pair is shown once. */
export function splitTwins(
  entries: LibraryIcon[],
  twins: Record<string, string>,
): { pairs: LibraryIcon[]; singles: LibraryIcon[] } {
  const paired = new Set([...Object.keys(twins), ...Object.values(twins)]);
  return {
    pairs: entries.filter((icon) => !!twins[icon.value]),
    singles: entries.filter((icon) => !paired.has(icon.value)),
  };
}

/** Template first, then the exact role, then its `family.*` pattern. */
export function defaultPair(
  pool: IconPool,
  templateId: string | undefined,
  role: string | undefined,
): IconPair | undefined {
  const value =
    (templateId
      ? effectiveDefault(pool, "templates", templateId)
      : undefined) ??
    (role ? effectiveDefault(pool, "roles", role) : undefined);
  if (!value) return undefined;
  const twin = pool.twins[value];
  return twin ? { value, activeValue: twin } : { value };
}

/** The value a key resolves to: the exact key, then (roles) its `family.*`. */
export function effectiveDefault(
  pool: IconPool,
  kind: DefaultKind,
  key: string,
): string | undefined {
  const exact = pool.defaults[kind][key];
  if (exact) return exact;
  if (kind === "roles") {
    const dot = key.indexOf(".");
    if (dot > 0) return pool.defaults.roles[`${key.slice(0, dot)}.*`];
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

/** Add a browsed value once; empty, duplicate and full pools are unchanged. */
export function addLibraryValue(
  pool: IconPool,
  value: string,
  meta?: { name?: string; keywords?: string[] },
): { pool: IconPool; added: boolean } {
  const trimmed = value.trim();
  if (!trimmed || pool.library.some((entry) => entry.value === trimmed)) {
    return { pool, added: false };
  }
  if (pool.library.length >= POOL_CAP) return { pool, added: false };
  const name = meta?.name?.trim() || undefined;
  const keywords = [
    ...new Set([
      ...(meta?.keywords ?? [])
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
      ...keywordWords(name ?? ""),
    ]),
  ];
  const icon: LibraryIcon = {
    id: newId(),
    ...(name ? { name } : {}),
    value: trimmed,
    keywords,
  };
  return { pool: upsertLibraryIcon(pool, icon), added: true };
}

/** Removing an icon also removes any pairing that names it. */
export function removeLibraryIcon(pool: IconPool, id: string): IconPool {
  const removed = pool.library.find((entry) => entry.id === id);
  const twins = { ...pool.twins };
  if (removed) {
    delete twins[removed.value];
    for (const [off, on] of Object.entries(twins)) {
      if (on === removed.value) delete twins[off];
    }
  }
  return {
    ...pool,
    updatedAt: Date.now(),
    library: pool.library.filter((entry) => entry.id !== id),
    twins,
  };
}

/** Pair one icon with its active twin; the twin becomes a library row too. */
export function setTwin(
  pool: IconPool,
  value: string,
  twin: string | null,
): IconPool {
  const off = value.trim();
  if (!off) return pool;
  const twins = { ...pool.twins };
  if (!twin || !twin.trim() || twin.trim() === off) {
    delete twins[off];
    return { ...pool, updatedAt: Date.now(), twins };
  }
  const on = twin.trim();
  // One relation per value: a new pair replaces a relation on either half.
  for (const [key, value] of Object.entries(twins)) {
    if (key === on || value === off || value === on) delete twins[key];
  }
  twins[off] = on;
  const library = pool.library.some((icon) => icon.value === on)
    ? pool.library
    : [
        ...pool.library,
        {
          id: `twin:${slug(on)}`,
          value: on,
          keywords: keywordWords(on),
        },
      ];
  return { ...pool, updatedAt: Date.now(), library, twins };
}

export function hasIconValue(library: LibraryIcon[], value: string): boolean {
  return library.some((icon) => icon.value === value);
}

/** Set or clear one default; an empty value removes the key. */
export function setDefault(
  pool: IconPool,
  kind: DefaultKind,
  key: string,
  value: string | null,
): IconPool {
  const trimmed = key.trim();
  const icon = value?.trim() ?? "";
  if (!trimmed) return pool;
  const defaults: IconPool["defaults"] = {
    roles: { ...pool.defaults.roles },
    templates: { ...pool.defaults.templates },
  };
  if (icon) defaults[kind][trimmed] = icon;
  else delete defaults[kind][trimmed];
  return { ...pool, updatedAt: Date.now(), defaults };
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

/** An MDI path as an inline icon that follows the resolved icon colour. */
export function mdiIconValue(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="{{$color}}"><path d="${path}"/></svg>`;
}
