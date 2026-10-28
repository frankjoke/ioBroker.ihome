import type { EnrichedDevice } from "$lib/types/device";
import type { Placement } from "$lib/types/display";
import type { FilterableDevice } from "$lib/config/pages-ops";

/** The reserved device id a placement without a device carries (B1). */
export const BLANK_DEVICE_ID = "@blank";

/**
 * The device a blank placement stands in with: nothing to show and no control.
 * Frozen — every consumer reads it, none may write it.
 */
export function blankDevice(): EnrichedDevice & FilterableDevice {
  return Object.freeze({
    id: BLANK_DEVICE_ID,
    name: "",
    type: "Custom" as const,
    controls: [],
    visibleControls: 0,
  });
}

/** A placement with no device (B1). */
export function isBlankPlacement(placement: Placement): boolean {
  return placement.device === BLANK_DEVICE_ID;
}
