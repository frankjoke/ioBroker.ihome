import type { DeviceType } from "$lib/types/device";
import type { Group, Member, Page, PageRegistry } from "$lib/types/display";
import { num, parseDoc, unwrapDoc } from "$lib/config/doc-parse";

/** A device reduced to what filtering needs. */
export interface FilterableDevice {
  id: string;
  name: string;
  type: DeviceType;
  room?: string;
  functions?: string[];
  favorites?: string[];
  tags?: string[];
  /** Controls that will render — hidden ones do not count. */
  visibleControls: number;
}

/** Ephemeral view filter (the chips in the display's top bar). */
export interface FilterChips {
  room?: string;
  function?: string;
  favorite?: string;
}

export interface ResolvedGroup<T = FilterableDevice> {
  group: Group;
  devices: T[];
}

/**
 * Does a device belong in a group? Every field the member sets must match.
 * An empty member matches **nothing** — a fresh group stays empty until it is
 * configured (spec §4.1.3), so a stray group can never swallow the registry.
 */
export function matchesMember(d: FilterableDevice, m: Member): boolean {
  if (!d || !m) return false; // a half-written group matches nothing
  const checks: boolean[] = [];
  if (m.ids) checks.push(m.ids.includes(d.id));
  if (m.room) checks.push(d.room === m.room);
  if (m.function) checks.push((d.functions ?? []).includes(m.function));
  if (m.favorite) checks.push((d.favorites ?? []).includes(m.favorite));
  if (m.type) checks.push(d.type === m.type);
  if (m.tags?.length) {
    checks.push(m.tags.every((t) => (d.tags ?? []).includes(t)));
  }
  return checks.length > 0 && checks.every(Boolean);
}

function claims(group: Group): boolean {
  return Array.isArray(group.member?.ids);
}

/**
 * Resolve a page: which devices land in which group.
 *
 * Claiming runs in two passes — explicit-id groups first, then filter groups —
 * so pinning a device into a group wins over any filter. The result is returned
 * in the page's **declaration order**, because that is the visual order the user
 * configured. A device claimed by an earlier group is never claimed again.
 */
export function resolvePage<T extends FilterableDevice>(
  page: Page,
  devices: T[],
): ResolvedGroup<T>[] {
  const groups = page.groups ?? [];
  const claimed = new Set<string>();
  const byGroup = new Map<string, T[]>();
  for (const pass of [
    groups.filter(claims),
    groups.filter((g) => !claims(g)),
  ]) {
    for (const group of pass) {
      const hit: T[] = [];
      for (const d of devices) {
        if (claimed.has(d.id)) continue;
        if (!matchesMember(d, group.member)) continue;
        // A device with no visible control is only shown when asked for.
        if (d.visibleControls < 1 && group.showEmpty !== true) continue;
        claimed.add(d.id);
        hit.push(d);
      }
      byGroup.set(group.id, hit);
    }
  }
  return groups
    .map((group) => ({ group, devices: byGroup.get(group.id) ?? [] }))
    .filter((r) => r.devices.length > 0 || r.group.showEmpty === true);
}

/** Apply the top-bar chips; only the set chips constrain. */
export function filterDevices<T extends FilterableDevice>(
  devices: T[],
  chips: FilterChips,
): T[] {
  return devices.filter(
    (d) =>
      (!chips.room || d.room === chips.room) &&
      (!chips.function || (d.functions ?? []).includes(chips.function)) &&
      (!chips.favorite || (d.favorites ?? []).includes(chips.favorite)),
  );
}

/**
 * Reduce a device to `FilterableDevice` while keeping the original object
 * identity, so the enriched device (live values and all) reaches the tile.
 */
export function toFilterable<
  T extends {
    id: string;
    name: string;
    type: DeviceType;
    room?: string;
    functions?: string[];
    favorites?: string[];
    tags?: string[];
    controls?: { hidden?: boolean }[];
  },
>(d: T): T & { visibleControls: number } {
  return {
    ...d,
    visibleControls: (d.controls ?? []).filter((c) => !c.hidden).length,
  };
}

/** One group id per enum id, stable across re-seeds. */
function groupId(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

/**
 * The first-run page set: a room page (rooms lead — `Device.room` is populated,
 * while `Device.functions` is a new field nothing has filled yet) and a function
 * page. Both use filters, so a device added later appears without touching the
 * pages.
 */
export function seedPages(
  functions: { id: string; label: string }[],
  rooms: { id: string; label: string }[],
): PageRegistry {
  return {
    version: 0,
    updatedAt: Date.now(),
    seeded: true,
    pages: [
      {
        id: "rooms",
        title: "Rooms",
        icon: "meeting_room",
        groups: rooms.map((r) => ({
          id: groupId("room", r.id),
          title: r.label,
          member: { room: r.id },
        })),
      },
      {
        id: "home",
        title: "Home",
        icon: "home",
        groups: functions.map((f) => ({
          id: groupId("fn", f.id),
          title: f.label,
          member: { function: f.id },
        })),
      },
    ],
  };
}

/**
 * Read a persisted page registry. Anything unusable returns null so the caller
 * can seed instead of losing the pages that are already loaded.
 */
function isGroup(v: unknown): v is Group {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    !!g.id &&
    !!g.member &&
    typeof g.member === "object"
  );
}

function isPage(v: unknown): v is Page {
  if (!v || typeof v !== "object") return false;
  const page = v as Record<string, unknown>;
  return (
    typeof page.id === "string" &&
    !!page.id &&
    Array.isArray(page.groups) &&
    page.groups.every(isGroup)
  );
}

export function parsePageRegistry(raw: unknown): PageRegistry | null {
  return parseDoc(raw, (value) => {
    const pages = value.pages;
    if (!Array.isArray(pages)) return null;
    // A document the renderer would crash on is not a document we accept.
    if (!pages.every(isPage)) return null;
    return {
      version: num(value.version, 0),
      updatedAt: num(value.updatedAt, Date.now()),
      ...(value.seeded ? { seeded: true } : {}),
      pages: pages as Page[],
    };
  });
}

/**
 * Decide what the page registry should be after loading: the stored pages when
 * there are any, otherwise a first-run seed, otherwise nothing.
 *
 * Seeding hangs off "the document has no pages", not off "the state read
 * succeeded": a freshly created ioBroker state has an object but no value, and
 * reading it reports *not found* — the empty case and the missing case look the
 * same from here, and both must seed.
 */
export type LoadedPages =
  | { kind: "loaded"; registry: PageRegistry }
  | { kind: "seeded"; registry: PageRegistry }
  | { kind: "absent"; registry: null }
  | { kind: "invalid"; registry: null };

export function loadPages(
  raw: unknown,
  seed?: () => PageRegistry,
): LoadedPages {
  const value = unwrapDoc(raw);
  if (value === undefined || value === null || value === "") {
    const fresh = seed?.();
    return fresh
      ? { kind: "seeded", registry: fresh }
      : { kind: "absent", registry: null };
  }
  const parsed = parsePageRegistry(value);
  // A stored document is authoritative — including an empty one (the user may
  // have deleted every page on purpose). Unreadable content is reported, not
  // replaced: overwriting it would destroy whatever was there.
  return parsed
    ? { kind: "loaded", registry: parsed }
    : { kind: "invalid", registry: null };
}
