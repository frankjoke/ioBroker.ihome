// The tile's own config as pure operations (A18): a tile is *materialised* —
// a complete {template, size, slots} copied from the device → template → preset
// chain — on the first edit, and diverges independently from then on. Reset
// drops `tile` and returns the tile to its chain. Every op returns a new value
// (input never mutated); the caller commits through the store's write path.
import type { Device } from "$lib/types/device";
import type { Placement, TileConfig, Template } from "$lib/types/display";
import { presetForType, resolveTemplate } from "$lib/config/template-ops";
import { deepCopy } from "$lib/utils/json";

/** The complete config a first edit starts from, deep-copied off the chain. */
export function materialiseTile(
  device: Device,
  templates: Template[],
): TileConfig {
  const resolved = resolveTemplate(device, templates);
  return {
    template: device.template ?? presetForType(device.type).id,
    size: { ...resolved.size },
    slots: deepCopy(resolved.slots),
  };
}

/**
 * A tile that has slots is already materialised; anything else gets the chain's
 * config, with whatever partial fields a legacy `tile` already carried (its
 * size, say) winning over the materialised base.
 */
export function ensureTile(
  placement: Placement,
  device: Device,
  templates: Template[],
): Placement & { tile: TileConfig } {
  if (placement.tile?.slots)
    return placement as Placement & { tile: TileConfig };
  const base = materialiseTile(device, templates);
  return {
    ...placement,
    // `slots` is re-pinned because a partial never carries one (the early
    // return already handled the case where it did).
    tile: { ...base, ...(placement.tile ?? {}), slots: base.slots },
  };
}

/** Back to the chain: the tile's own config disappears entirely (A18). */
export function resetTile(placement: Placement): Placement {
  const rest: Placement = { ...placement };
  delete rest.tile;
  return rest;
}
