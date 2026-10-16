// The tile's own config as pure operations (A18): a tile is *materialised* —
// a complete {template, size, slots} copied from the device → template → preset
// chain — on the first edit, and diverges independently from then on. Reset
// drops `tile` and returns the tile to its chain. Every op returns a new value
// (input never mutated); the caller commits through the store's write path.
import type { Device } from "$lib/types/device";
import type {
  PageRegistry,
  Placement,
  Rule,
  Slot,
  TileConfig,
  Template,
} from "$lib/types/display";
import { presetForType, resolveTemplate } from "$lib/config/template-ops";
import {
  mapPlacement,
  moveItem,
  type PlacementAnchor,
} from "$lib/config/layout-ops";
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

// ------------------------------------------------------------------- slots

function withSlots(tile: TileConfig, slots: Slot[]): TileConfig {
  return { ...tile, slots };
}

/** Insert a slot (append by default); `at` is clamped into range. */
export function addSlot(tile: TileConfig, slot: Slot, at?: number): TileConfig {
  const slots = [...(tile.slots ?? [])];
  const index = Math.max(0, Math.min(at ?? slots.length, slots.length));
  slots.splice(index, 0, slot);
  return withSlots(tile, slots);
}

/** A bad index leaves the list — copied — untouched, like `moveItem`. */
export function removeSlot(tile: TileConfig, index: number): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).filter((_, i) => i !== index),
  );
}

export function moveSlot(
  tile: TileConfig,
  from: number,
  to: number,
): TileConfig {
  return withSlots(tile, moveItem(tile.slots ?? [], from, to));
}

export function patchSlot(
  tile: TileConfig,
  index: number,
  patch: Partial<Slot>,
): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).map((slot, i) =>
      i === index ? { ...slot, ...patch } : slot,
    ),
  );
}

// ------------------------------------------------------------------- rules

/** Address one slot's rule list; a bad slot index returns a copied tile. */
function withRules(
  tile: TileConfig,
  slotIndex: number,
  fn: (rules: Rule[]) => Rule[],
): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).map((slot, i) =>
      i === slotIndex ? { ...slot, rules: fn(slot.rules ?? []) } : slot,
    ),
  );
}

export function addRule(
  tile: TileConfig,
  slotIndex: number,
  rule: Rule,
  at?: number,
): TileConfig {
  return withRules(tile, slotIndex, (rules) => {
    const copy = [...rules];
    const index = Math.max(0, Math.min(at ?? copy.length, copy.length));
    copy.splice(index, 0, rule);
    return copy;
  });
}

export function patchRule(
  tile: TileConfig,
  slotIndex: number,
  ruleIndex: number,
  patch: Partial<Rule>,
): TileConfig {
  return withRules(tile, slotIndex, (rules) =>
    rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)),
  );
}

export function removeRule(
  tile: TileConfig,
  slotIndex: number,
  ruleIndex: number,
): TileConfig {
  return withRules(tile, slotIndex, (rules) =>
    rules.filter((_, i) => i !== ruleIndex),
  );
}

export function moveRule(
  tile: TileConfig,
  slotIndex: number,
  from: number,
  to: number,
): TileConfig {
  return withRules(tile, slotIndex, (rules) => moveItem(rules, from, to));
}

// ------------------------------------------------------------------ edits

/** The pane's and the tree's one way to edit a tile: materialise once, then
 *  apply `fn` to its own config. Unknown addresses return the registry untouched. */
export function editTile(
  reg: PageRegistry,
  anchor: PlacementAnchor,
  device: Device,
  templates: Template[],
  fn: (tile: TileConfig) => TileConfig,
): PageRegistry {
  return mapPlacement(
    reg,
    anchor.pageId,
    anchor.sectionId,
    anchor.placementId,
    (placement) => {
      const ensured = ensureTile(placement, device, templates);
      return { ...ensured, tile: fn(ensured.tile) };
    },
  );
}
