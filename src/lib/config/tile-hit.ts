import type { PlacementAnchor } from "$lib/config/layout-ops";

/** The attribute a tile's root carries to say where it sits (A48). */
const PLACEMENT = "data-placement-id";

/** The one thing a hit-stack element must offer — `Element` satisfies it. */
export interface HitElement {
  getAttribute(name: string): string | null;
}

/**
 * The placement a click landed on: the first element in the hit stack that
 * carries a placement id, with the page and section it belongs to (A48).
 *
 * The stack is `document.elementsFromPoint(...)` — innermost first — so a click
 * on a nested control (an icon, a chart) resolves to the tile around it. A gap
 * or a section heading carries no placement and answers `null`: the click
 * selects nothing rather than guessing.
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
