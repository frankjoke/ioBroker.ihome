// The tile's own config as pure operations (A18): a tile is *materialised* —
// a complete {template, size, slots} copied from the device → template → preset
// chain — on the first edit, and diverges independently from then on. Reset
// drops `tile` and returns the tile to its chain. Every op returns a new value
// (input never mutated); the caller commits through the store's write path.
import type { Device } from "$lib/types/device";
import type {
  ActiveCondition,
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
import { truthy } from "$lib/config/rule-ops";
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

// ------------------------------------------------------------------ active

/**
 * The tile's active reading: `truthy` uses the app's on/off reading; the
 * comparisons go numeric when both sides parse as finite numbers and otherwise
 * compare case-insensitively as text. No condition, an unknown op or a missing
 * value is never active.
 */
export function evalActive(
  cond: ActiveCondition | undefined,
  value: unknown,
): boolean {
  if (!cond) return false;
  if (cond.op === "truthy") return truthy(value);
  if (cond.value === undefined) return false;

  const left = value === null || value === undefined ? "" : String(value);
  const right = cond.value;
  const numeric = left.trim() !== "" && right.trim() !== "";
  const l = numeric ? Number(left) : NaN;
  const r = numeric ? Number(right) : NaN;

  if (Number.isFinite(l) && Number.isFinite(r)) {
    switch (cond.op) {
      case "gt":
        return l > r;
      case "gte":
        return l >= r;
      case "lt":
        return l < r;
      case "lte":
        return l <= r;
      case "eq":
        return l === r;
      case "ne":
        return l !== r;
      default:
        return false;
    }
  }

  const a = left.toLowerCase();
  const b = right.toLowerCase();
  switch (cond.op) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    default:
      return false;
  }
}
