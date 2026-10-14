import type { DeviceType } from "$lib/types/device";
import type { Group, Member, Page, PageRegistry } from "$lib/types/display";

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
 * The first-run page set: one page of function groups (the broker's functions
 * are the sane axis) and one page of room groups. Both use filters, so a device
 * added later appears without touching the pages.
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
        id: "home",
        title: "Home",
        icon: "home",
        groups: functions.map((f) => ({
          id: groupId("fn", f.id),
          title: f.label,
          member: { function: f.id },
        })),
      },
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
    ],
  };
}
