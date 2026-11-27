import {
  dropIndex,
  movePlacement,
  type PlacementAnchor,
} from "$lib/config/layout-ops";
import type { PageRegistry } from "$lib/types/display";

export interface DragRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface DragTile {
  pageId: string;
  sectionId: string;
  placementId: string;
  rect: DragRect;
}

export interface DragSection {
  pageId: string;
  sectionId: string;
  rect: DragRect;
  /** The section's inner grid, used to place the line in an empty section. */
  contentRect?: DragRect;
}

export interface DropTarget {
  pageId: string;
  sectionId: string;
  /** The gap index before which the tile is inserted. */
  index: number;
  line: { left: number; top: number; height: number };
}

export interface DropPlan {
  before: PageRegistry;
  after: PageRegistry;
  from: PlacementAnchor;
  to: PlacementAnchor;
  /** The moved placement's title, for the toast. */
  title: string;
}

function contains(rect: DragRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The touch drag handle's hit square: a 44 px square from a tile's top-left.
 *  The visual grip is smaller; the extra area is the finger target. */
export const DRAG_HANDLE_HIT = 44;

export function handleHit(rect: DragRect, x: number, y: number): boolean {
  return (
    x >= rect.left &&
    x <= rect.left + DRAG_HANDLE_HIT &&
    y >= rect.top &&
    y <= rect.top + DRAG_HANDLE_HIT
  );
}

/** Where a dragged tile would land. A tile answers by its left/right half; a
 *  section hit outside its tiles appends; an empty section uses its grid box. */
export function dropTargetFrom(
  tiles: DragTile[],
  sections: DragSection[],
  x: number,
  y: number,
): DropTarget | null {
  let hit: DragTile | undefined;
  for (const tile of tiles) {
    if (contains(tile.rect, x, y)) hit = tile;
  }
  if (hit) {
    const sectionTiles = tiles.filter(
      (tile) =>
        tile.pageId === hit?.pageId && tile.sectionId === hit?.sectionId,
    );
    const index = sectionTiles.indexOf(hit);
    const before = x < hit.rect.left + hit.rect.width / 2;
    return {
      pageId: hit.pageId,
      sectionId: hit.sectionId,
      index: before ? index : index + 1,
      line: {
        left: before ? hit.rect.left - 4 : hit.rect.right + 4,
        top: hit.rect.top,
        height: hit.rect.height,
      },
    };
  }
  const section = sections.find((entry) => contains(entry.rect, x, y));
  if (!section) return null;
  const sectionTiles = tiles.filter(
    (tile) =>
      tile.pageId === section.pageId && tile.sectionId === section.sectionId,
  );
  const last = sectionTiles.at(-1)?.rect;
  const content = section.contentRect ?? section.rect;
  return {
    pageId: section.pageId,
    sectionId: section.sectionId,
    index: sectionTiles.length,
    line: {
      left: last ? last.right + 4 : content.left + 4,
      top: last ? last.top : content.top + 8,
      height: last ? last.height : 40,
    },
  };
}

/** Plan a drag drop against the registry; null when it is a no-op or stale. */
export function planDrop(
  registry: PageRegistry,
  anchor: PlacementAnchor,
  target: DropTarget,
): DropPlan | null {
  const sourceSection = registry.pages
    .find((page) => page.id === anchor.pageId)
    ?.groups?.find((group) => group.id === anchor.sectionId);
  const targetSection = registry.pages
    .find((page) => page.id === target.pageId)
    ?.groups?.find((group) => group.id === target.sectionId);
  const fromIndex =
    sourceSection?.tiles?.findIndex((tile) => tile.id === anchor.placementId) ??
    -1;
  if (fromIndex < 0 || !targetSection) return null;
  const same =
    anchor.pageId === target.pageId && anchor.sectionId === target.sectionId;
  const toIndex = dropIndex(fromIndex, target.index, same);
  // Dropping on itself is a no-op only within the same section; moving to
  // index 0 of another section is a real move even when the indices match.
  if (same && toIndex === fromIndex) return null;
  const after = movePlacement(
    registry,
    {
      pageId: anchor.pageId,
      sectionId: anchor.sectionId,
      index: fromIndex,
    },
    {
      pageId: target.pageId,
      sectionId: target.sectionId,
      index: toIndex,
    },
  );
  if (after === registry) return null;
  return {
    before: registry,
    after,
    from: anchor,
    to: {
      pageId: target.pageId,
      sectionId: target.sectionId,
      placementId: anchor.placementId,
    },
    title: sourceSection.tiles?.[fromIndex]?.title?.trim() || "Tile",
  };
}

/** The registry an Undo may restore, or null when a later edit landed.
 *  `committed` is the registry object returned by the store **after** the drop
 *  (Svelte wraps it in a proxy, so it is not the raw `plan.after`). */
export function planUndo(
  plan: DropPlan,
  committed: PageRegistry,
  current: PageRegistry,
): PageRegistry | null {
  return current === committed ? plan.before : null;
}
