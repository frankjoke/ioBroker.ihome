import { widgetFor } from "$lib/config/features";
import { slotFromControl, slotKindForWidget } from "$lib/config/slot-create";
import {
  resolveControl,
  resolveTemplate,
  pickSlotControls,
  tileTitle,
} from "$lib/config/template-ops";
import { stateIdFor, type GlobalVariable } from "$lib/config/variables";
import type { Control, Device } from "$lib/types/device";
import type {
  PageRegistry,
  Placement,
  Slot,
  SlotKind,
  SlotSource,
  TileConfig,
  Template,
} from "$lib/types/display";

/** What the migration did, for the one-time report. */
export interface MigrationReport {
  placements: number;
  slots: number;
  droppedSlots: number;
  droppedPlacements: number;
}

/** The v1 document shape, read internally so the public types can be narrowed. */
type LegacySlot = Omit<Slot, "source"> & { source?: string | SlotSource };
type LegacyPlacement = Omit<Placement, "tile"> & {
  device?: string;
  tile?: Omit<TileConfig, "slots"> & { slots?: LegacySlot[] };
};

function controlSource(device: Device, control: Control): SlotSource {
  return { kind: "control", device: device.id, control: control.id };
}

function stateSource(
  raw: string,
  variables: GlobalVariable[],
): SlotSource | undefined {
  const id = stateIdFor(raw, variables);
  return id.includes(".") ? { kind: "state", stateId: id } : undefined;
}

function convertSource(
  raw: string,
  device: Device | undefined,
  variables: GlobalVariable[],
): SlotSource | undefined {
  const control = device
    ? resolveControl(device.controls ?? [], raw)
    : undefined;
  if (control && device) return controlSource(device, control);
  return stateSource(raw, variables);
}

function kindFor(control: Control, device: Device, legacy: SlotKind): SlotKind {
  const widget = widgetFor(device.type, control.feature);
  if (legacy === "value" && widget !== "value") {
    return slotKindForWidget(widget);
  }
  return legacy;
}

/** One v1 slot → v2; undefined means it was dormant and is dropped. */
function convertSlot(
  raw: LegacySlot,
  device: Device | undefined,
  variables: GlobalVariable[],
): Slot | undefined {
  if (raw.kind === "frame") {
    const rest: LegacySlot = { ...raw };
    delete rest.source;
    return rest as Slot;
  }
  if (raw.source && typeof raw.source === "object") return raw as Slot;

  const rawSource = typeof raw.source === "string" ? raw.source : undefined;

  if (raw.kind === "badge") {
    if (rawSource === "offline") {
      return device
        ? { ...raw, source: { kind: "device", device: device.id } }
        : undefined;
    }
    if (rawSource === "ago") {
      const of =
        typeof raw.options?.of === "string" ? raw.options.of : undefined;
      const source = of
        ? convertSource(of, device, variables)
        : device
          ? ({ kind: "device", device: device.id } as SlotSource)
          : undefined;
      if (!source) return undefined;
      const options = { ...(raw.options ?? {}) };
      delete options.of;
      return { ...raw, source, options: { ...options, derive: "ago" } };
    }
    const source = rawSource
      ? convertSource(rawSource, device, variables)
      : undefined;
    return source ? { ...raw, source } : undefined;
  }

  if (!rawSource) return undefined;
  const source = convertSource(rawSource, device, variables);
  if (!source) return undefined;
  if (source.kind === "state") return { ...raw, source };
  if (source.kind !== "control") return undefined;

  // A control source: copy the metadata the device control still knows, and
  // choose the renderer kind from its widget.
  const control = device?.controls?.find((c) => c.id === source.control);
  if (!device || !control) return undefined;
  const base = slotFromControl(
    device,
    control,
    widgetFor(device.type, control.feature),
  );
  return {
    ...base,
    ...raw,
    kind: kindFor(control, device, raw.kind),
    source,
    label: raw.label ?? base.label,
    unit: raw.unit ?? base.unit,
    ...(base.options || raw.options
      ? { options: { ...base.options, ...raw.options } }
      : {}),
  };
}

function convertActive(
  source: string | SlotSource,
  device: Device | undefined,
  variables: GlobalVariable[],
): SlotSource | undefined {
  if (typeof source === "object") return source;
  return convertSource(source, device, variables);
}

/**
 * One-way v1 → v2: every placement becomes a tile of slots. Chain-only tiles
 * are materialised for the device's real controls; dormant slots and empty
 * placements are dropped. Idempotent: a device-free, object-sourced document is
 * returned unchanged.
 */
export function migratePagesV2(
  reg: PageRegistry,
  devices: Device[],
  templates: Template[],
  variables: GlobalVariable[] = [],
): { registry: PageRegistry; report: MigrationReport; changed: boolean } {
  let changed = false;
  const report: MigrationReport = {
    placements: 0,
    slots: 0,
    droppedSlots: 0,
    droppedPlacements: 0,
  };

  const pages = (reg.pages ?? []).map((page) => ({
    ...page,
    groups: (page.groups ?? []).map((group) => {
      const tiles: Placement[] = [];
      for (const raw of group.tiles ?? []) {
        const legacy = raw as LegacyPlacement;
        const device = legacy.device
          ? devices.find((d) => d.id === legacy.device)
          : undefined;
        const chain =
          !legacy.tile?.slots && device
            ? resolveTemplate(device, templates)
            : undefined;
        const sourceSlots: LegacySlot[] =
          legacy.tile?.slots ?? chain?.slots ?? [];

        const slots: Slot[] = [];
        const picked = device
          ? pickSlotControls(sourceSlots as Slot[], device.controls ?? [], {})
          : [];
        sourceSlots.forEach((slot, index) => {
          if (
            slot.source === undefined &&
            slot.kind !== "frame" &&
            device &&
            picked[index]?.control
          ) {
            const control = picked[index].control!;
            const base = slotFromControl(
              device,
              control,
              widgetFor(device.type, control.feature),
            );
            slots.push({
              ...base,
              ...slot,
              kind: kindFor(control, device, slot.kind),
              source: {
                kind: "control",
                device: device.id,
                control: control.id,
              },
              label: slot.label ?? base.label,
              unit: slot.unit ?? base.unit,
              ...(base.options || slot.options
                ? { options: { ...base.options, ...slot.options } }
                : {}),
            });
            return;
          }
          const converted = convertSlot(slot, device, variables);
          if (converted) slots.push(converted);
          else {
            report.droppedSlots++;
            changed = true;
          }
        });

        if (!slots.length) {
          report.droppedPlacements++;
          changed = true;
          continue;
        }

        const tile: TileConfig = legacy.tile
          ? { ...legacy.tile, slots }
          : {
              ...(chain?.size ? { size: chain.size } : {}),
              slots,
            };
        delete (tile as { template?: string }).template;

        if (tile.active) {
          const activeSource = convertActive(
            tile.active.source,
            device,
            variables,
          );
          if (activeSource) {
            tile.active = { ...tile.active, source: activeSource };
          } else {
            delete tile.active;
            changed = true;
          }
        }

        const title = legacy.title ?? (device ? tileTitle(device) : undefined);
        const placement: Placement = {
          id: legacy.id,
          ...(title !== undefined ? { title } : {}),
          ...(legacy.newLine !== undefined ? { newLine: legacy.newLine } : {}),
          tile,
        };
        if (legacy.device !== undefined) changed = true;
        if (sourceSlots.some((s) => typeof s.source === "string")) {
          changed = true;
        }
        tiles.push(placement);
        report.placements++;
        report.slots += slots.length;
      }
      return { ...group, tiles };
    }),
  }));

  return {
    registry: changed ? { ...reg, pages } : reg,
    report,
    changed,
  };
}
