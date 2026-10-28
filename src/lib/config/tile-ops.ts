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
  SlotIcon,
  SlotSpark,
  StateLook,
  TileConfig,
  Template,
  TemplateRegistry,
} from "$lib/types/display";
import { presetForType, resolveTemplate } from "$lib/config/template-ops";
import { BLANK_DEVICE_ID } from "$lib/config/blank-tile";
import {
  mapPlacement,
  moveItem,
  type PlacementAnchor,
} from "$lib/config/layout-ops";
import { truthy } from "$lib/config/rule-ops";
import { deepCopy } from "$lib/utils/json";
import { newId } from "$lib/utils/ids";

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
  const base: TileConfig =
    placement.device === BLANK_DEVICE_ID
      ? { size: { w: 1, h: 1 }, slots: [] }
      : materialiseTile(device, templates);
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

/**
 * Pin a slot on one explicit source (A36). A hint behind a source is dead
 * weight — the source always wins — so it goes with the pick, and an options
 * object left empty goes too, like `setSlotWhere` dropping the default. A bad
 * index leaves the list — copied — untouched, like `removeSlot`.
 */
export function setSlotSource(
  tile: TileConfig,
  index: number,
  source: string,
): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).map((slot, i) => {
      if (i !== index) return slot;
      const options = { ...(slot.options ?? {}) };
      delete options.pick;
      const copy: Slot = { ...slot, source };
      if (Object.keys(options).length) copy.options = options;
      else delete copy.options;
      return copy;
    }),
  );
}

/** Where a slot lives (A34): the tile by default, or the modal, or both. */
export function slotWhere(slot: Slot): "tile" | "both" | "modal" {
  return slot.where ?? "tile";
}

/**
 * Set where a slot lives (A34). Refused — the tile comes back untouched — when
 * it would leave no slot on the main tile: the modal is an enlargement, never
 * a slot's only home. A bad index leaves the list alone, like `moveItem`.
 */
export function setSlotWhere(
  tile: TileConfig,
  index: number,
  where: "tile" | "both" | "modal",
): TileConfig {
  const slots = tile.slots ?? [];
  if (index < 0 || index >= slots.length) return tile;
  const next = slots.map((slot, i) => {
    if (i !== index) return slot;
    const copy = { ...slot };
    // Absent means tile, and an absent field is what the documents carry —
    // switching back to the default drops it instead of storing "tile".
    if (where === "tile") delete copy.where;
    else copy.where = where;
    return copy;
  });
  if (!next.some((slot) => slotWhere(slot) !== "modal")) return tile;
  return withSlots(tile, next);
}

/**
 * The next home a click on the slot row's destination button moves to (A34):
 * tile → both → modal → tile, except that "modal" is skipped while this is the
 * only slot left on the main tile — so the cycle never lands on a refused move.
 */
export function nextSlotWhere(
  slot: Slot,
  tileVisible: number,
): "tile" | "both" | "modal" {
  const cur = slotWhere(slot);
  const next = cur === "tile" ? "both" : cur === "both" ? "modal" : "tile";
  return next === "modal" && tileVisible <= 1 ? "tile" : next;
}

// ------------------------------------------------------------------- icons

/** Set or clear one icon field (A51): `undefined` removes the key, and a
 *  descriptor left without keys disappears — editing never leaves `icon: {}`
 *  behind. A bad index leaves the list — copied — untouched. */
export function patchIcon(
  tile: TileConfig,
  index: number,
  patch: Partial<SlotIcon>,
): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).map((slot, i) => {
      if (i !== index) return slot;
      const next: SlotIcon = { ...(slot.icon ?? {}), ...patch };
      for (const key of Object.keys(next) as (keyof SlotIcon)[]) {
        if (next[key] === undefined) delete next[key];
      }
      const copy: Slot = { ...slot };
      if (Object.keys(next).length) copy.icon = next;
      else delete copy.icon;
      return copy;
    }),
  );
}

// -------------------------------------------------------------------- look

/** Set or clear one state's look fields (A71). `undefined` removes the key and
 *  a state left without keys disappears, then the `look` itself — editing never
 *  leaves `look: { active: {} }` behind. Other tile fields are untouched. */
export function setLook(
  tile: TileConfig,
  state: "active" | "inactive",
  patch: Partial<StateLook>,
): TileConfig {
  const look = { ...(tile.look ?? {}) };
  const entry: StateLook = { ...(look[state] ?? {}), ...patch };
  for (const key of Object.keys(entry) as (keyof StateLook)[]) {
    if (entry[key] === undefined) delete entry[key];
  }
  if (Object.keys(entry).length) look[state] = entry;
  else delete look[state];
  return {
    ...tile,
    look: Object.keys(look).length ? look : undefined,
  };
}

// ------------------------------------------------------------------- charts

/** Set or clear one spark field (A59): the `patchIcon` shape — `undefined`
 *  removes the key, a descriptor left without keys disappears, and a bad index
 *  leaves the list untouched. */
export function patchSpark(
  tile: TileConfig,
  index: number,
  patch: Partial<SlotSpark>,
): TileConfig {
  return withSlots(
    tile,
    (tile.slots ?? []).map((slot, i) => {
      if (i !== index) return slot;
      const next: SlotSpark = { ...(slot.spark ?? {}), ...patch };
      for (const key of Object.keys(next) as (keyof SlotSpark)[]) {
        if (next[key] === undefined) delete next[key];
      }
      const copy: Slot = { ...slot };
      if (Object.keys(next).length) copy.spark = next;
      else delete copy.spark;
      return copy;
    }),
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

/**
 * A glyph picked in the pane is the slot's face (A51): the slot's own rules stop
 * swapping it, or the choice would never show. Their colour, tone, `disabled` and
 * `hidden` stay — only the glyph is dropped (A70).
 */
export function clearRuleIcons(
  tile: TileConfig,
  slotIndex: number,
): TileConfig {
  const rules = (tile.slots ?? [])[slotIndex]?.rules ?? [];
  if (!rules.some((rule) => rule.icon !== undefined)) return tile;
  return withRules(tile, slotIndex, (list) =>
    list.map((rule) =>
      rule.icon === undefined ? rule : { ...rule, icon: undefined },
    ),
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

// ---------------------------------------------------------------- templates

/** The tile's layout as a per-type template: size + slots + CSS background; the
 *  type's features come from the chain, `active` stays on the tile (A19). */
export function templateFromTile(
  tile: TileConfig,
  device: Device,
  templates: Template[],
  name: string,
): Template {
  const chain = resolveTemplate(device, templates);
  return {
    id: newId(),
    name: name.trim(),
    type: device.type,
    size: { ...(tile.size ?? chain.size) },
    features: deepCopy(chain.features),
    slots: deepCopy(tile.slots ?? []),
    ...(tile.background ? { background: deepCopy(tile.background) } : {}),
  };
}

/** Append, or replace the template with the same (name, type) keeping its id. */
export function upsertTemplate(
  registry: TemplateRegistry,
  template: Template,
): TemplateRegistry {
  const list = registry.templates ?? [];
  const at = list.findIndex(
    (t) => t.name === template.name && t.type === template.type,
  );
  const next = [...list];
  if (at < 0) next.push(deepCopy(template));
  else next[at] = { ...deepCopy(template), id: list[at].id };
  return {
    ...registry,
    version: (registry.version ?? 0) + 1,
    updatedAt: Date.now(),
    templates: next,
  };
}

/** Replace the placement's size, slots and background with the template's; the
 *  tile's own active condition survives. */
export function applyTemplate(
  placement: Placement,
  template: Template,
): Placement {
  const active = placement.tile?.active;
  const size = template.size ?? placement.tile?.size;
  return {
    ...placement,
    tile: {
      template: template.id,
      ...(size ? { size: { ...size } } : {}),
      ...(template.background
        ? { background: deepCopy(template.background) }
        : {}),
      ...(active ? { active: deepCopy(active) } : {}),
      slots: deepCopy(template.slots),
    },
  };
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
