import type { Device, DeviceType } from "$lib/types/device";
import { newId } from "$lib/utils/ids";
import type {
  Group,
  Member,
  Page,
  PageRegistry,
  Placement,
} from "$lib/types/display";
import { enumsOfState } from "$lib/config/rooms";
import { num, parseDoc, unwrapDoc } from "$lib/config/doc-parse";
import { slugify, uniqueSlug } from "$lib/config/slug";

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

/** Legacy shape: a section with the devices its filter claims (the migration only). */
export interface MemberGroup<T = FilterableDevice> {
  group: Group;
  devices: T[];
}

/** One tile of a section: its placement. */
export interface ResolvedTile {
  placement: Placement;
}

/** What the display renders: a section and its tiles, in order. */
export interface ResolvedGroup {
  group: Group;
  tiles: ResolvedTile[];
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
 * Legacy membership: which devices land in which group, by filter or explicit ids.
 *
 * The display no longer resolves a page this way — a section's members are its
 * placements (A8) — this is what the one-time migration runs so that a document
 * written before placements keeps rendering.
 *
 * Claiming runs in two passes — explicit-id groups first, then filter groups —
 * so pinning a device into a group wins over any filter. The result is returned
 * in the page's **declaration order**, because that is the visual order the user
 * configured. A device claimed by an earlier group is never claimed again.
 */
export function resolveByMember<T extends FilterableDevice>(
  page: Page,
  devices: T[],
): MemberGroup<T>[] {
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

/**
 * One section's tiles: its placements in order, each with the device it points
 * at. A placement whose device is gone is skipped (the section keeps its other
 * tiles), and a device with nothing to show is skipped unless the section asks
 * for empties.
 */
export function resolveSection(group: Group): ResolvedTile[] {
  return (group.tiles ?? []).map((placement) => ({ placement }));
}

/**
 * Resolve a page for the display: every section's placements, in order.
 * Membership is explicit now (A8), so the same device may appear in more than
 * one section — nothing is claimed — and a section with nothing to show
 * disappears unless it asks for empties.
 */
export function resolvePage(page: Page): ResolvedGroup[] {
  return (page.groups ?? [])
    .map((group) => ({ group, tiles: resolveSection(group) }))
    .filter((r) => r.tiles.length > 0 || r.group.showEmpty === true);
}

/** The page-registry schema version this build writes (A15). */
export const PAGE_REGISTRY_VERSION = 2;

/**
 * The one-time bridge from a member-based document to explicit placements: every
 * section without `tiles` gets the devices its filter resolves to today, in that
 * order, each as a placement. `member` stays behind as the filter hint.
 *
 * Idempotent — a section that already carries `tiles` is untouched — and a
 * registry already at `PAGE_REGISTRY_VERSION` with every section listed is
 * returned **as it is** (same object), so a caller can compare or skip a write.
 * `changed` tells the caller whether the document needs writing.
 */
export function migratePageRegistry(
  reg: PageRegistry,
  devices: FilterableDevice[],
): { registry: PageRegistry; changed: boolean } {
  const pages = reg.pages ?? [];
  // Never migrate a registry that was never loaded: the store's initial value is
  // `{ version: 0, updatedAt: 0, pages: [] }`, and a failed read leaves it in
  // place. Bumping *that* to `PAGE_REGISTRY_VERSION` writes an empty document
  // over the user's pages. A stored empty document carries an `updatedAt`, so it
  // still passes (the user may have deleted every page on purpose).
  if (pages.length === 0 && !reg.updatedAt) {
    return { registry: reg, changed: false };
  }
  // An empty device list means "nothing loaded yet", not "there are no devices".
  // Migrating a legacy section now would freeze `tiles: []` into the user's
  // document, and the next migration would see that section as complete.
  const legacy = pages.some((page) =>
    (page.groups ?? []).some((group) => !Array.isArray(group.tiles)),
  );
  if (legacy && devices.length === 0) {
    return { registry: reg, changed: false };
  }
  const needsTiles = pages.some((page) =>
    (page.groups ?? []).some((group) => !Array.isArray(group.tiles)),
  );
  const needsVersion = (reg.version ?? 0) < PAGE_REGISTRY_VERSION;
  if (!needsTiles && !needsVersion) return { registry: reg, changed: false };

  const migrated = pages.map((page) => {
    if ((page.groups ?? []).every((group) => Array.isArray(group.tiles))) {
      return page;
    }
    // The order the display showed yesterday is the order the placements get.
    const resolved = new Map(
      resolveByMember(page, devices).map((r) => [r.group.id, r.devices]),
    );
    return {
      ...page,
      groups: (page.groups ?? []).map((group) =>
        Array.isArray(group.tiles)
          ? group
          : {
              ...group,
              tiles: (resolved.get(group.id) ?? []).map((d) => ({
                id: newId(),
                device: d.id,
              })),
            },
      ),
    };
  });

  return {
    registry: {
      ...reg,
      version: PAGE_REGISTRY_VERSION,
      updatedAt: Date.now(),
      pages: migrated,
    },
    changed: true,
  };
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
  const pages: Page[] = [];
  if (rooms.length) {
    pages.push({
      id: "rooms",
      title: "Rooms",
      icon: "meeting_room",
      groups: rooms.map((r) => ({
        id: groupId("room", r.id),
        title: r.label,
        member: { room: r.id },
      })),
    });
  }
  if (functions.length) {
    pages.push({
      id: "home",
      title: "Home",
      icon: "home",
      groups: functions.map((f) => ({
        id: groupId("fn", f.id),
        title: f.label,
        member: { function: f.id },
      })),
    });
  }
  return {
    version: 0,
    updatedAt: Date.now(),
    seeded: true,
    // Only axes that exist: an axis with no enums would seed a page that can
    // never show a device (`Device.functions` has nothing to match).
    pages,
  };
}

/**
 * Read a persisted page registry. Anything unusable returns null so the caller
 * can seed instead of losing the pages that are already loaded.
 */
function isPlacement(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id) return false;
  // v1 placements carry a device; v2 placements do not (and must carry a tile
  // config — a tile without a slot has nothing to show). Both parse.
  if (t.device !== undefined && (typeof t.device !== "string" || !t.device)) {
    return false;
  }
  if (t.device === undefined && (!t.tile || typeof t.tile !== "object")) {
    return false;
  }
  if (t.title !== undefined && typeof t.title !== "string") return false;
  if (t.newLine !== undefined && typeof t.newLine !== "boolean") return false;
  if (t.tile !== undefined && (!t.tile || typeof t.tile !== "object")) {
    return false;
  }
  return true;
}

function isGroup(v: unknown): v is Group {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  if (typeof g.id !== "string" || !g.id) return false;
  // `member` is a filter hint now (A8) — a section may carry no member at all —
  // but when it is there it must still be an object.
  if (!(g.member === undefined || (!!g.member && typeof g.member === "object")))
    return false;
  // A missing list is a legacy section the migration completes; a list that is
  // there must actually be placements. Accepting junk here would let the
  // migration overwrite it with `[]` and let the renderer throw on `null`.
  if (g.tiles === undefined) return true;
  if (!Array.isArray(g.tiles) || !g.tiles.every(isPlacement)) return false;
  const ids = (g.tiles as { id: string }[]).map((t) => t.id);
  return new Set(ids).size === ids.length;
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

/**
 * May the stored document be written back after this load? Only a document we
 * actually read (`loaded`) or one we just seeded may be replaced — an `absent`
 * (nothing loaded, e.g. a dropped socket) or `invalid` (unreadable) read must
 * never be overwritten with whatever is in memory.
 */
export function mayWritePages(kind: LoadedPages["kind"] | null): boolean {
  return kind === "loaded" || kind === "seeded";
}

/** What `newId()` produces: the ids the '+' used to give every page. */
const GENERATED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One-time rename of generated page ids to the slug of their title, so a page
 * link reads `#/p/wohnzimmer` instead of a UUID. Readable ids (the seeded
 * `rooms`/`home`, or a slug) are left alone; a title without latin letters
 * keeps its generated id. The map lets the caller rewrite the last page and
 * redirect an open link; the returned registry is the same object when there
 * was nothing to rename, so no write is triggered.
 */
export function migratePageIds(reg: PageRegistry): {
  registry: PageRegistry;
  renames: Record<string, string>;
} {
  const taken = new Set(reg.pages.map((page) => page.id));
  const renames: Record<string, string> = {};
  const pages = reg.pages.map((page) => {
    if (!GENERATED_ID.test(page.id)) return page;
    const base = slugify(page.title ?? "");
    if (!base) return page;
    const id = uniqueSlug(base, taken);
    taken.add(id);
    renames[page.id] = id;
    return { ...page, id };
  });
  if (!Object.keys(renames).length) return { registry: reg, renames };
  return {
    registry: { ...reg, pages, updatedAt: Date.now() },
    renames,
  };
}

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

/**
 * Fill in `functions` / `favorites` on devices that have none, from the
 * membership the broker already maintains on the *states* (ioBroker admin /
 * rega keeps `enum.functions.*` and `enum.favorites.*` member lists). Explicit
 * assignments are never overwritten, and a device with no state-backed control
 * is left alone.
 *
 * The display filters on the device fields (spec §4.1.6: explicit, not derived),
 * so this is the one-time bridge from what the broker knows to what the display
 * reads. The phase-4 editors maintain it from there.
 */
export function backfillEnumFields(
  devices: Device[],
  enums: any,
): { devices: Device[]; changed: number } {
  let changed = 0;
  const out = (devices ?? []).map((device) => {
    if (device.functions?.length || device.favorites?.length) return device;
    const functions = new Set<string>();
    const favorites = new Set<string>();
    for (const control of device.controls ?? []) {
      if (!control.stateId) continue;
      for (const id of enumsOfState(enums, control.stateId, "functions")) {
        functions.add(id);
      }
      for (const id of enumsOfState(enums, control.stateId, "favorites")) {
        favorites.add(id);
      }
    }
    if (!functions.size && !favorites.size) return device;
    changed++;
    return {
      ...device,
      ...(functions.size ? { functions: [...functions] } : {}),
      ...(favorites.size ? { favorites: [...favorites] } : {}),
    };
  });
  return { devices: out, changed };
}

/** What the display shows while no page can be rendered yet. */
export type PlaceholderReason = "connecting" | "unreadable" | "none";

/**
 * Which notice the display deserves while it has no page to draw. "No pages
 * yet" is the *last* of the three: on a fresh start the document arrives a
 * moment after the socket, and a page-less first paint is a promise the app
 * has not kept yet. `absent`/`invalid` mean the read came back empty-handed —
 * that is "could not be read", never "there are no pages".
 */
export function pagePlaceholder(
  connected: boolean,
  kind: LoadedPages["kind"] | null,
): PlaceholderReason {
  if (!connected || kind === null) return "connecting";
  if (kind === "absent" || kind === "invalid") return "unreadable";
  return "none";
}
