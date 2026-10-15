import type { Group, Placement } from "$lib/types/display";
import type { ResolvedTile } from "$lib/config/pages-ops";

/**
 * The layout pass: where the renderer puts each tile, and how wide a section is.
 *
 * The tree is the UI definition (pages → sections → tile entries), so this is
 * where its structural properties are *interpreted*: a tile entry may ask to
 * start a new line, and the section is as wide as its widest row. Nothing here
 * knows about devices beyond the resolved tiles it is handed.
 */

/** How many tile modules fit in `width` px, given the module and gap sizes. */
export function modulesFor(
  width: number,
  tileW: number,
  gap = 6,
  padding = 0,
): number {
  const usable = Math.max(0, width - padding) + gap;
  return Math.max(1, Math.floor(usable / (tileW + gap)));
}

/** One tile with the position the renderer gives it (module units, 0-based). */
export interface PlacedTile<T = unknown> {
  tile: ResolvedTile<T>;
  /** The tree entry itself: its `id` and `newLine` drive the placement. */
  placement: Placement;
  row: number;
  column: number;
  /** Its width in modules, clamped to what the page can show. */
  span: number;
}

export interface PlacedSection<T = unknown> {
  group: Group;
  tiles: PlacedTile<T>[];
  /** The section's width in modules: as wide as its widest row. */
  modules: number;
  rows: number;
}

/**
 * Place one section's tiles: left to right, wrapping only when the next tile
 * would not fit — or when the tile entry carries `newLine`.
 */
export function layoutSection<T>(
  group: Group,
  tiles: ResolvedTile<T>[],
  spanOf: (tile: ResolvedTile<T>) => number,
  maxModules: number,
): PlacedSection<T> {
  const limit = Math.max(1, maxModules);
  const placed: PlacedTile<T>[] = [];
  let row = 0;
  let column = 0;
  let widest = 0;

  for (const tile of tiles) {
    const span = Math.min(Math.max(1, Math.round(spanOf(tile)) || 1), limit);
    const breakBefore = tile.placement.newLine === true && column > 0;
    if (breakBefore || column + span > limit) {
      row += 1;
      column = 0;
    }
    placed.push({ tile, placement: tile.placement, row, column, span });
    column += span;
    widest = Math.max(widest, column);
  }

  return {
    group,
    tiles: placed,
    modules: widest,
    rows: placed.length ? row + 1 : 0,
  };
}
