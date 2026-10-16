import { newId } from "$lib/utils/ids";
import type { Group, Page, PageRegistry, Placement } from "$lib/types/display";

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
 * Read a placement handoff back out of storage. Anything a stale tab or an older
 * build could have left there returns null, so a bad value can never select a
 * tile that does not exist.
 */
export function parsePlacementRef(raw: unknown): PlacementAnchor | null {
  if (typeof raw !== "string" || !raw) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { pageId, sectionId, placementId } = value;
  if (
    typeof pageId === "string" &&
    pageId &&
    typeof sectionId === "string" &&
    sectionId &&
    typeof placementId === "string" &&
    placementId
  ) {
    return { pageId, sectionId, placementId };
  }
  return null;
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
 * A placement copy with a fresh id. Nested config is copied one level deep,
 * which is enough because every op replaces objects instead of mutating them.
 */
function clonePlacement(placement: Placement): Placement {
  return {
    ...placement,
    id: newId(),
    ...(placement.tile
      ? {
          tile: {
            ...placement.tile,
            ...(placement.tile.size
              ? { size: { ...placement.tile.size } }
              : {}),
          },
        }
      : {}),
  };
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

export function addPage(reg: PageRegistry, title = "New page"): PageRegistry {
  return withPages(reg, (pages) => [
    ...pages,
    { id: newId(), title, groups: [] },
  ]);
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
): PageRegistry {
  return mapPage(reg, pageId, (page) => ({
    ...page,
    groups: [...(page.groups ?? []), { id: newId(), title, tiles: [] }],
  }));
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
 * Append devices to a section as placements, in the given order. Ids already in
 * the section are skipped, and so are repeats inside `deviceIds` — the picker
 * can hand us a list with duplicates without creating two tiles for one device.
 */
export function appendDevices(
  reg: PageRegistry,
  pageId: string,
  sectionId: string,
  deviceIds: string[],
): PageRegistry {
  return mapSection(reg, pageId, sectionId, (section) => {
    const seen = new Set((section.tiles ?? []).map((tile) => tile.device));
    const added: Placement[] = [];
    for (const device of deviceIds) {
      if (!device || seen.has(device)) continue;
      seen.add(device);
      added.push({ id: newId(), device });
    }
    return { ...section, tiles: [...(section.tiles ?? []), ...added] };
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
