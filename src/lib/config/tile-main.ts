import { setSlotSource } from "$lib/config/tile-ops";
import { tileHeadlineSlot } from "$lib/config/tile-parts";
import { sourceKey } from "$lib/config/slot-source";
import type { Slot, TileConfig } from "$lib/types/display";

/** A state id a source names, if it is a raw state (not a feature/control). */
function stateIdOf(source: Slot["source"]): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string")
    return source.includes(".") ? source : undefined;
  return source.kind === "state" ? source.stateId : undefined;
}

/** What a slot's `options.of` can name for a derived badge. */
function referenceOf(source: Slot["source"]): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  if (source.kind === "state") return source.stateId;
  if (source.kind === "control") return source.control;
  return undefined;
}

/**
 * Change the headline slot's source, and carry every reference to the old
 * source inside this tile along: other slot sources (including one with a
 * different override on the same state), badge `options.of`, and the active
 * condition. An independent source is left alone. Rule expressions are not
 * rewritten — they are code, not a source field.
 */
export function setMainSlotSource(
  tile: TileConfig,
  index: number,
  source: Slot["source"],
): TileConfig {
  const slots = tile.slots ?? [];
  const main = tileHeadlineSlot(slots);
  const mainIndex = main ? slots.indexOf(main) : -1;
  if (mainIndex !== index) return setSlotSource(tile, index, source);

  const oldSource = slots[index]?.source;
  const next = setSlotSource(tile, index, source);
  if (!oldSource || !source) return next;
  const oldKey = sourceKey(oldSource);
  if (sourceKey(source) === oldKey) return next;
  const oldStateId = stateIdOf(oldSource);
  const newReference = referenceOf(source);

  const matchesSource = (candidate: Slot["source"]): boolean =>
    !!candidate &&
    (sourceKey(candidate) === oldKey ||
      (!!oldStateId && stateIdOf(candidate) === oldStateId));
  const matchesReference = (reference: string): boolean =>
    reference === oldStateId ||
    reference === (typeof oldSource === "string" ? oldSource : undefined) ||
    (typeof oldSource === "object" &&
      oldSource?.kind === "control" &&
      reference === oldSource.control) ||
    (typeof oldSource === "object" &&
      oldSource?.kind === "device" &&
      reference === oldSource.device);

  const nextSlots = (next.slots ?? []).map((slot, i) => {
    if (i === index) return slot;
    let sourceOut = slot.source;
    let options = slot.options;
    let sourceChanged = false;
    if (matchesSource(sourceOut)) {
      sourceOut = source;
      sourceChanged = true;
    }
    if (
      options &&
      typeof options.of === "string" &&
      newReference &&
      matchesReference(options.of)
    ) {
      options = { ...options, of: newReference };
    }
    if (!sourceChanged) {
      return options === slot.options ? slot : { ...slot, options };
    }
    if (options) {
      options = { ...options };
      // A replaced source wins over the old readout hint.
      delete options.pick;
      if (!Object.keys(options).length) options = undefined;
    }
    return { ...slot, source: sourceOut, options };
  });

  const active =
    next.active && matchesSource(next.active.source)
      ? { ...next.active, source }
      : next.active;
  return { ...next, slots: nextSlots, active };
}
