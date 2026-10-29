import type {
  EnrichedControl,
  EnrichedDevice,
  Widget,
} from "$lib/types/device";
import type { Slot, SlotKind, TileConfig } from "$lib/types/display";
import {
  resolveSlotSource,
  type ResolvedSource,
  type SourceLook,
} from "$lib/config/slot-source";

/** What a tile's slots resolve to: a control bag shaped like a device, the
 *  tile with pseudo-id sources, and the live sources behind each id. */
export interface TileResolution {
  device: EnrichedDevice;
  tile: TileConfig;
  sources: Map<string, ResolvedSource>;
}

function widgetForKind(kind: SlotKind): Widget | undefined {
  switch (kind) {
    case "switch":
      return "switch";
    case "level":
      return "level";
    case "color":
      return "color";
    case "enum":
      return "enum";
    case "button":
      return "button";
    default:
      return undefined;
  }
}

function pseudoControl(
  id: string,
  slot: Slot,
  resolved: ResolvedSource | undefined,
): EnrichedControl {
  const widget =
    widgetForKind(slot.kind) ?? resolved?.widget ?? ("value" as Widget);
  return {
    id,
    feature:
      resolved?.control?.feature ??
      resolved?.label ??
      resolved?.stateId ??
      "value",
    stateId: resolved?.stateId,
    writable: resolved?.writable === true,
    label: slot.label ?? resolved?.label,
    unit: slot.unit ?? resolved?.unit,
    liveValue: resolved?.value,
    available: resolved?.available === true,
    exists: resolved?.available === true,
    object: resolved?.object,
    widget,
    transform: resolved?.control?.transform,
    history: resolved?.control?.history,
    rules: resolved?.control?.rules,
    hidden: resolved?.control?.hidden === true,
  };
}

/**
 * Resolve a tile without a device: every control/state source becomes a
 * per-slot control in a synthetic bag, so the rules, badges, charts and widgets
 * keep one code path. The bag is not the tile's identity — it is derived from
 * its slots and disappears with them.
 */
export function resolveTile(
  tile: TileConfig | undefined,
  title: string | undefined,
  look: SourceLook,
): TileResolution {
  const controls: EnrichedControl[] = [];
  const sources = new Map<string, ResolvedSource>();
  const slots: Slot[] = [];

  (tile?.slots ?? []).forEach((slot, index) => {
    if (slot.kind === "frame" || slot.kind === "html") {
      slots.push(slot);
      return;
    }
    if (typeof slot.source === "string" || !slot.source) {
      // Legacy v1 string (or a source-less slot): left for the old raw/feature
      // resolver; the migration removes strings.
      slots.push(slot);
      return;
    }

    const resolved = resolveSlotSource(slot.source, look);
    const key = `slot:${index}`;
    if (resolved) sources.set(key, resolved);

    if (slot.kind === "badge" && slot.source.kind === "device") {
      // The badge stays tied to *this* device: its pseudo-control carries the
      // device's availability and the clock key names the rescued state ids.
      controls.push(pseudoControl(key, slot, resolved));
      slots.push({
        ...slot,
        source: slot.options?.derive === "ago" ? "ago" : "offline",
        options: { ...slot.options, derive: undefined, of: key },
      });
      return;
    }

    controls.push(pseudoControl(key, slot, resolved));
    if (slot.kind === "badge" && slot.options?.derive === "ago") {
      slots.push({
        ...slot,
        source: "ago",
        options: { ...slot.options, of: key, derive: undefined },
      });
      return;
    }
    slots.push({ ...slot, source: key });
  });

  const available = controls.some((c) => c.available);
  const device = {
    id: "tile",
    name: title ?? "",
    type: "Custom" as const,
    controls,
    available,
    exists: controls.length > 0,
  } as EnrichedDevice;

  return {
    device,
    tile: { ...(tile ?? {}), slots },
    sources,
  };
}
