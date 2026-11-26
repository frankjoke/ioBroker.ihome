import { setSlotSource } from "$lib/config/tile-ops";
import { tileHeadlineSlot } from "$lib/config/tile-parts";
import { sourceKey } from "$lib/config/slot-source";
import type { Slot, TileConfig } from "$lib/types/display";

/** Change a slot's source, and keep a "Main state" active condition following
 *  the headline when that is the slot that changed. An independently chosen
 *  active source stays untouched. */
export function setMainSlotSource(
  tile: TileConfig,
  index: number,
  source: Slot["source"],
): TileConfig {
  const slots = tile.slots ?? [];
  const main = tileHeadlineSlot(slots);
  const mainIndex = main ? slots.indexOf(main) : -1;
  const followsMain =
    mainIndex === index &&
    !!tile.active &&
    sourceKey(tile.active.source) === sourceKey(main?.source);
  const next = setSlotSource(tile, index, source);
  if (!followsMain) return next;
  const nextMain = tileHeadlineSlot(next.slots ?? []);
  if (!nextMain?.source) return next;
  return {
    ...next,
    active: {
      ...(next.active ?? { op: "truthy" as const }),
      source: nextMain.source,
    },
  };
}
