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
  const tileId =
    (selection?.kind === "tile" ? selection.placementId : undefined) ??
    tiles[0]?.id ??
    "";
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
 * What changing a placement's device means (A25/A50): the Device line's selector
 * can pick the device it already has (nothing), a device for a tile that carries
 * no config of its own (just do it), or a device for a tile that does (ask —
 * its slots, background and active condition were built for the old one).
 */
export function swapDecision(
  placement: Placement | undefined,
  deviceId: string,
): "noop" | "confirm" | "apply" {
  if (!placement || !deviceId || placement.device === deviceId) return "noop";
  return placement.tile ? "confirm" : "apply";
}
