import type { Group, Page, PageRegistry, Placement } from "$lib/types/display";
import type { LayoutSelection } from "$lib/config/layout-ops";

/**
 * Where the layout sheet is pointing, derived from the selection it holds.
 *
 * The sheet's whole navigation is this one value: page → section → tile, each
 * with a defined fallback, so the sheet always shows something and no state can
 * dangle (A45). Pure on purpose — the fallbacks are the part worth testing.
 */
export interface SheetCursor {
  page?: Page;
  pageId: string;
  section?: Group;
  sectionId: string;
  tiles: Placement[];
  tile?: Placement;
  tileId: string;
  /** −1 when the section has no tiles. */
  tileIndex: number;
}

export function sheetCursor(
  registry: PageRegistry,
  selection: LayoutSelection | null,
  /** The display's page (A45): the cursor's page is the display's page, so this
   *  wins when it is given and the selection's page is only the fallback. */
  pageId?: string,
): SheetCursor {
  // The page: the display's, else the selection's, else the first. A page the
  // document no longer has (deleted, or a stale handoff) falls back rather than
  // dangling.
  const wantedPage = pageId || selection?.pageId || "";
  const page =
    registry.pages.find((p) => p.id === wantedPage) ?? registry.pages[0];
  const currentPageId = page?.id ?? "";

  // The section a non-page selection points into — never one of another page.
  const wantedSection =
    selection && selection.kind !== "page" ? selection.sectionId : undefined;
  const section =
    page?.groups.find((g) => g.id === wantedSection) ?? page?.groups[0];
  const sectionId = section?.id ?? "";

  const tiles = section?.tiles ?? [];
  // A tile that was deleted (or a stale handoff) falls back to the section's
  // first, like every other step — the sheet never points at a tile that is not
  // there (A45).
  const wantedTile =
    selection?.kind === "tile" ? selection.placementId : undefined;
  const tileId =
    tiles.find((t) => t.id === wantedTile)?.id ?? tiles[0]?.id ?? "";
  const tileIndex = tiles.findIndex((t) => t.id === tileId);

  return {
    page,
    pageId: currentPageId,
    section,
    sectionId,
    tiles,
    tile: tiles[tileIndex],
    tileId,
    tileIndex,
  };
}

/**
 * A tile line's label (A44): what the placement is called, plus its size when it
 * has one — `name · w×h`. The name is the placement's own title, else the
 * device name the caller passes as a suggestion, else `Tile` — a tile has no
 * device identity of its own (v2).
 */
export function tileLabel(placement: Placement, deviceName?: string): string {
  const name = placement.title || deviceName || "Tile";
  const size = placement.tile?.size;
  return size ? `${name} · ${size.w}×${size.h}` : name;
}
