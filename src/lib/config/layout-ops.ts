import { newId } from "$lib/utils/ids";
import { deepCopy } from "$lib/utils/json";
import { slugify, uniqueSlug } from "$lib/config/slug";
import { resolveControl } from "$lib/config/template-ops";
import type {
  Group,
  Page,
  PageRegistry,
  Placement,
  Slot,
} from "$lib/types/display";
import type { Device } from "$lib/types/device";

/**
 * Every mutation the layout editor can make, as a pure function.
 *
 * Each op returns a **new** registry (input never mutated) with `updatedAt`
 * bumped; the caller persists it through the store's single write path. An op
 * that names a page/section/placement which does not exist returns the registry
 * with its pages untouched — a stale editor action must never destroy config.
 */

/** Where to drop a placement: by index (a move), not by id (an address). */
export interface PlacementMove {
  pageId: string;
  sectionId: string;
  index: number;
}

/**
 * One tile's address inside the tree — the editor's selection, and what the
 * display hands over when a tile is opened for editing.
 */
export interface PlacementAnchor {
  pageId: string;
  sectionId: string;
  placementId: string;
}

/** What the layout editor has selected. */
export type LayoutSelection =
  | { kind: "page"; pageId: string }
  | { kind: "section"; pageId: string; sectionId: string }
  | ({ kind: "tile" } & PlacementAnchor);

/**
 * Read a layout handoff: the deepest node whose ids are all present. Anything a
 * stale tab or an older build left behind returns null, so a bad value can never
 * select something that does not exist.
 */
export function parseLayoutRef(raw: unknown): LayoutSelection | null {
  if (typeof raw !== "string" || !raw) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { pageId, sectionId, placementId } = value;
  if (typeof pageId !== "string" || !pageId) return null;
  // The deepest node whose ids are all present: a placement without its
  // section would not be addressable, so it degrades instead of failing.
  if (typeof sectionId !== "string" || !sectionId) {
    return { kind: "page", pageId };
  }
  if (typeof placementId !== "string" || !placementId) {
    return { kind: "section", pageId, sectionId };
  }
  return { kind: "tile", pageId, sectionId, placementId };
}

function withPages(
  reg: PageRegistry,
  fn: (pages: Page[]) => Page[],
): PageRegistry {
  return { ...reg, updatedAt: Date.now(), pages: fn(reg.pages ?? []) };
}

function mapPage(
  reg: PageRegistry,
  pageId: string,
  fn: (page: Page) => Page,
): PageRegistry {
  return withPages(reg, (pages) =>
    pages.map((page) => (page.id === pageId ? fn(page) : page)),
  );
}

function mapSection(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  fn: (section: Group) => Group,
): PageRegistry {
  return mapPage(reg, pageId, (page) => ({
    ...page,
    groups: (page.groups ?? []).map((group) =>
      group.id === sectionId ? fn(group) : group,
    ),
  }));
}

/**
 * Move one item within a list. `to` is the item's **final** index, so anything
 * outside `0 … list.length-1` (a drop past the end, an equal index) is a no-op —
 * always as a copy, so callers can rely on getting a new array back.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from === to) return copy;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return copy;
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) {
    return copy;
  }
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/**
 * A placement copy with a fresh id. Deep-copied (M2): a plain spread would leave
 * the copy sharing the original's slot/rule arrays, so editing the copy would
 * silently edit the original too.
 */
function clonePlacement(placement: Placement): Placement {
  return { ...deepCopy(placement), id: newId() };
}

/** A section copy with a fresh id — and a fresh id for each of its tiles. */
function cloneSection(section: Group): Group {
  return {
    ...section,
    id: newId(),
    member: section.member ? { ...section.member } : undefined,
    appearance: section.appearance
      ? {
          ...section.appearance,
          background: section.appearance.background
            ? { ...section.appearance.background }
            : undefined,
        }
      : undefined,
    tiles: (section.tiles ?? []).map((tile) => clonePlacement(tile)),
  };
}

// ------------------------------------------------------------------- pages

/**
 * A page is a room: it comes with one empty section, so a new room is usable
 * right away — there is no tile without a section.
 */
export function addPage(
  reg: PageRegistry,
  title = "New page",
  at?: number,
): PageRegistry {
  return withPages(reg, (pages) => {
    const next = [...pages];
    // The id is the readable link (#/p/<id>): the name's slug, made unique.
    // It is chosen here and never follows a later rename.
    const base = slugify(title);
    const id = base
      ? uniqueSlug(
          base,
          pages.map((page) => page.id),
        )
      : newId();
    next.splice(at ?? next.length, 0, {
      id,
      title,
      groups: [{ id: newId(), title: "New section", tiles: [] }],
    });
    return next;
  });
}

export function deletePage(reg: PageRegistry, pageId: string): PageRegistry {
  return withPages(reg, (pages) => pages.filter((page) => page.id !== pageId));
}

export function duplicatePage(reg: PageRegistry, pageId: string): PageRegistry {
  return withPages(reg, (pages) => {
    const at = pages.findIndex((page) => page.id === pageId);
    if (at < 0) return pages;
    const source = pages[at];
    const copy: Page = {
      ...source,
      id: newId(),
      title: `${source.title} copy`,
      groups: (source.groups ?? []).map((group) => cloneSection(group)),
    };
    return [...pages.slice(0, at + 1), copy, ...pages.slice(at + 1)];
  });
}

export function movePage(
  reg: PageRegistry,
  from: number,
  to: number,
): PageRegistry {
  return withPages(reg, (pages) => moveItem(pages, from, to));
}

/**
 * Patch a page's own fields (title, icon, background, …). `undefined` removes a
 * field, so an emptied one disappears from the document.
 */
export function patchPage(
  reg: PageRegistry,
  pageId: string,
  patch: Partial<Page>,
): PageRegistry {
  return mapPage(reg, pageId, (page) => ({ ...page, ...patch }));
}

// ---------------------------------------------------------------- sections

export function addSection(
  reg: PageRegistry,
  pageId: string,
  title = "New section",
  at?: number,
): PageRegistry {
  return mapPage(reg, pageId, (page) => {
    const groups = [...(page.groups ?? [])];
    groups.splice(at ?? groups.length, 0, { id: newId(), title, tiles: [] });
    return { ...page, groups };
  });
}

/** Is `title` already a sibling's? Trimmed and case-insensitive, so "Bad"
 *  and " bad " are the same name to the selectors. An empty name is not a
 *  duplicate — the caller decides whether it may exist at all. */
function titleTaken(
  items: { id: string; title?: string }[],
  title: string,
  exceptId?: string,
): boolean {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return false;
  return items.some(
    (item) =>
      item.id !== exceptId &&
      (item.title ?? "").trim().toLowerCase() === wanted,
  );
}

/** Would a new page with this title collide with an existing one? */
export function pageTitleTaken(
  reg: PageRegistry,
  title: string,
  exceptId?: string,
): boolean {
  return titleTaken(reg.pages, title, exceptId);
}

/** Would a new section with this title collide inside this page? */
export function sectionTitleTaken(
  page: Page | undefined,
  title: string,
  exceptId?: string,
): boolean {
  return titleTaken(page?.groups ?? [], title, exceptId);
}

export function deleteSection(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
): PageRegistry {
  return mapPage(reg, pageId, (page) => ({
    ...page,
    groups: (page.groups ?? []).filter((group) => group.id !== sectionId),
  }));
}

export function duplicateSection(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
): PageRegistry {
  return mapPage(reg, pageId, (page) => {
    const groups = page.groups ?? [];
    const at = groups.findIndex((group) => group.id === sectionId);
    if (at < 0) return page;
    const copy = cloneSection(groups[at]);
    return {
      ...page,
      groups: [...groups.slice(0, at + 1), copy, ...groups.slice(at + 1)],
    };
  });
}

export function moveSection(
  reg: PageRegistry,
  pageId: string,
  from: number,
  to: number,
): PageRegistry {
  return mapPage(reg, pageId, (page) => ({
    ...page,
    groups: moveItem(page.groups ?? [], from, to),
  }));
}

/** Move a whole section to the end of another page. Same page or a missing
 *  source/target leaves the registry untouched. */
export function moveSectionToPage(
  reg: PageRegistry,
  fromPageId: string,
  sectionId: string,
  toPageId: string,
): PageRegistry {
  if (fromPageId === toPageId) return reg;
  const from = reg.pages.find((p) => p.id === fromPageId);
  const section = from?.groups?.find((g) => g.id === sectionId);
  const to = reg.pages.find((p) => p.id === toPageId);
  if (!section || !to) return reg;
  return {
    ...reg,
    pages: reg.pages.map((p) => {
      if (p.id === fromPageId) {
        return {
          ...p,
          groups: (p.groups ?? []).filter((g) => g.id !== sectionId),
        };
      }
      if (p.id === toPageId) {
        return { ...p, groups: [...(p.groups ?? []), section] };
      }
      return p;
    }),
  };
}

/**
 * Patch a section's own fields (title, icon, appearance, …). A field set to
 * `undefined` disappears from the document instead of being stored empty.
 */
export function patchSection(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  patch: Partial<Group>,
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => ({
    ...section,
    ...patch,
  }));
}

// ---------------------------------------------------------------- placements

/**
 * Add a tile that starts with its first slot (S8): a tile is never empty, and
 * the source picker's pick is what creates it. `at` inserts at that index
 * instead of appending (the list-end `+`).
 */
export function appendTile(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  slot: Slot,
  at?: number,
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => {
    const tiles = [...(section.tiles ?? [])];
    tiles.splice(at ?? tiles.length, 0, {
      id: newId(),
      tile: { slots: [slot] },
    });
    return { ...section, tiles };
  });
}

export function deletePlacement(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  placementId: string,
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => ({
    ...section,
    tiles: (section.tiles ?? []).filter((tile) => tile.id !== placementId),
  }));
}

/**
 * How many slots point at this device: directly (control/device sources) or
 * through a legacy string that names one of its controls. Deleting the device
 * leaves every tile in place; the count is what the confirm warns about.
 */
export function slotsReferencingDevice(
  reg: PageRegistry,
  device: Device,
): number {
  let count = 0;
  for (const page of reg.pages ?? []) {
    for (const section of page.groups ?? []) {
      for (const placement of section.tiles ?? []) {
        for (const slot of placement.tile?.slots ?? []) {
          const source = slot.source;
          if (typeof source === "string") {
            // A v1 string names a control, not a device: attribute it through
            // the placement's own device when that is still recorded.
            const owner = placement.device;
            if (
              (!owner || owner === device.id) &&
              resolveControl(device.controls ?? [], source)
            ) {
              count++;
            }
          } else if (
            (source?.kind === "control" || source?.kind === "device") &&
            source.device === device.id
          ) {
            count++;
          }
        }
      }
    }
  }
  return count;
}

export function duplicatePlacement(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  placementId: string,
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => {
    const tiles = section.tiles ?? [];
    const at = tiles.findIndex((tile) => tile.id === placementId);
    if (at < 0) return section;
    const copy = clonePlacement(tiles[at]);
    return {
      ...section,
      tiles: [...tiles.slice(0, at + 1), copy, ...tiles.slice(at + 1)],
    };
  });
}

/**
 * The one place an address is walked: map the placement `placementId` in the
 * named section, leaving every sibling (and a stale address) untouched.
 */
export function mapPlacement(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  placementId: string,
  fn: (placement: Placement) => Placement,
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => ({
    ...section,
    tiles: (section.tiles ?? []).map((tile) =>
      tile.id === placementId ? fn(tile) : tile,
    ),
  }));
}

/**
 * Patch one placement (title, tile, device, …). `undefined` removes a field.
 */
export function patchPlacement(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  placementId: string,
  patch: Partial<Placement>,
): PageRegistry {
  return mapPlacement(reg, pageId, sectionId, placementId, (tile) => ({
    ...tile,
    ...patch,
  }));
}

/**
 * Move a placement inside its section (`to.index` is a final index) or into
 * another section (`to.index` is an insertion point, `0 … length`), including
 * another page.
 */
export function movePlacement(
  reg: PageRegistry,
  from: PlacementMove,
  to: PlacementMove,
): PageRegistry {
  if (from.pageId === to.pageId && from.sectionId === to.sectionId) {
    return mapSection(reg, from.pageId, from.sectionId, (section) => ({
      ...section,
      tiles: moveItem(section.tiles ?? [], from.index, to.index),
    }));
  }

  const source = (reg.pages ?? [])
    .find((page) => page.id === from.pageId)
    ?.groups.find((group) => group.id === from.sectionId);
  const target = (reg.pages ?? [])
    .find((page) => page.id === to.pageId)
    ?.groups.find((group) => group.id === to.sectionId);
  const moving = source?.tiles?.[from.index];
  // Nothing is removed until a real destination exists: a stale editor action
  // (a section deleted in another tab) must never lose the placement.
  if (!moving || !target) return reg;
  if (to.index < 0 || to.index > (target.tiles ?? []).length) return reg;

  const removed = mapSection(reg, from.pageId, from.sectionId, (section) => ({
    ...section,
    tiles: (section.tiles ?? []).filter((_, i) => i !== from.index),
  }));
  return mapSection(removed, to.pageId, to.sectionId, (section) => {
    const tiles = [...(section.tiles ?? [])];
    const at = Math.max(0, Math.min(to.index, tiles.length));
    tiles.splice(at, 0, moving);
    return { ...section, tiles };
  });
}
