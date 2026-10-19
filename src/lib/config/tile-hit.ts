import type { PlacementAnchor } from "$lib/config/layout-ops";

/** The attribute a tile's root carries to say where it sits (A48). */
const PLACEMENT = "data-placement-id";

/** What a hit target must offer — `Element` satisfies all of it. */
export interface HitElement {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

/**
 * The placement an element carries, with the page and section it belongs to
 * (A48). An element without a placement id (a gap, a section heading, the
 * layer itself) answers `null`: the click selects nothing rather than guessing.
 */
export function placementAt(
  stack: HitElement[],
  attr = PLACEMENT,
): PlacementAnchor | null {
  for (const el of stack ?? []) {
    const placementId = el.getAttribute(attr)?.trim();
    if (!placementId) continue;
    return {
      pageId: el.getAttribute("data-page-id") ?? "",
      sectionId: el.getAttribute("data-section-id") ?? "",
      placementId,
    };
  }
  return null;
}

/**
 * The placement under a point, found by the tiles' own boxes (A48).
 *
 * Not `elementsFromPoint`: the stage is `inert` while the sheet is open, and
 * inert content is not hit-tested — the layer would find nothing but itself.
 * The boxes are unaffected by inertness, so the tiles are walked instead, later
 * ones (painted on top) winning. A point in a gap answers `null`.
 */
export function placementUnder(
  tiles: HitElement[],
  x: number,
  y: number,
): PlacementAnchor | null {
  let found: HitElement | undefined;
  for (const el of tiles ?? []) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      found = el;
    }
  }
  return found ? placementAt([found]) : null;
}
