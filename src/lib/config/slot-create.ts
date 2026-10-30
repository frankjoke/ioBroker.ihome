import { localizeName } from "$lib/config/format";
import { widgetFor } from "$lib/config/features";
import { presetGlyph } from "$lib/config/icon-ops";
import {
  resolveControl,
  resolveTemplate,
  tileTitle,
} from "$lib/config/template-ops";
import { effectiveCommon, widgetForMeta } from "$lib/config/state-meta";
import type { Control, Device, Widget } from "$lib/types/device";
import type { Size, Slot, SlotKind, Template } from "$lib/types/display";

/** The slot that renders a control widget. */
export function slotKindForWidget(widget: Widget): SlotKind {
  switch (widget) {
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
      return "value";
  }
}

function rangeOptions(common: Record<string, any>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of ["min", "max", "step"] as const) {
    if (common[key] !== undefined) options[key] = common[key];
  }
  return options;
}

/** A slot from a device control: metadata is copied, the source stays live. */
export function slotFromControl(
  device: Device,
  control: Control & { object?: { common?: Record<string, any> } },
  widget?: Widget,
): Slot {
  // The control's correction is the truth about what it reads (spec §3): a
  // "power" feature may be a number (W/Wh) even though the type preset says
  // switch. The device type/feature map is only the fallback when the effective
  // shape says nothing.
  const meta =
    (control as any).meta ?? effectiveCommon(control, control.object);
  const w = widgetForMeta(
    meta,
    widget ?? widgetFor(device.type, control.feature),
  );
  const options = rangeOptions(meta);
  const label = control.label ?? meta.name;
  // No unit copy: the resolver returns the effective unit (and hideUnit).
  return {
    kind: slotKindForWidget(w),
    source: { kind: "control", device: device.id, control: control.id },
    ...(label ? { label } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  };
}

/** A slot from a raw broker state, with the state's own metadata copied. */
export function slotFromState(
  stateId: string,
  object: any,
  kind: SlotKind,
): Slot {
  const common = object?.common ?? {};
  const options = rangeOptions(common);
  const label = localizeName(common.name);
  return {
    kind,
    source: { kind: "state", stateId },
    ...(label ? { label } : {}),
    ...(common.unit ? { unit: common.unit } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  };
}

/**
 * A device's probable slots: walk a recipe (the type preset or a user
 * template), resolve each hint to one of the device's **actual** controls, and
 * drop everything that matches nothing. No control, no slot.
 */
export function suggestedSlots(device: Device, recipe: Slot[]): Slot[] {
  const out: Slot[] = [];
  for (const slot of recipe) {
    // A recipe names its control by source or by hint (`options.pick`); the
    // hinted presets (Thermometer's positional readings) use the latter.
    const hint =
      typeof slot.source === "string"
        ? slot.source
        : String(slot.options?.pick ?? "");
    if (!hint.trim()) continue;
    const control = resolveControl(
      (device.controls ?? []).filter((c) => !c.hidden),
      hint,
    );
    if (!control) continue;
    const widget = widgetFor(device.type, control.feature);
    const base = slotFromControl(device, control, widget);
    // The live state's shape wins over the recipe's kind: a recipe's "switch"
    // hint on a Wh reading must still render as a value. Non-widget kinds
    // (history-list, icon, …) are the recipe's own and stay.
    const widgetKinds: SlotKind[] = [
      "value",
      "level",
      "switch",
      "color",
      "enum",
      "button",
    ];
    const kind = widgetKinds.includes(slot.kind) ? base.kind : slot.kind;
    // The hint is dead weight once the source pins the control (A36).
    const options: Record<string, unknown> = { ...(base.options ?? {}) };
    for (const [key, value] of Object.entries(slot.options ?? {})) {
      if (key !== "pick" && value !== undefined) options[key] = value;
    }
    out.push({
      ...base,
      ...slot,
      kind,
      source: base.source,
      label: slot.label ?? base.label,
      unit: slot.unit ?? base.unit,
      ...(Object.keys(options).length ? { options } : { options: undefined }),
    });
  }
  return out;
}

/** What a brand-new tile inherits from its first slot: a name, the type's size
 *  and one default glyph. An offer frozen at creation, never a live link (S11). */
export interface TileSeed {
  title?: string;
  size?: Size;
  icon?: string;
}

export function tileSeed(
  slots: Slot[],
  devices: Device[],
  templates: Template[],
): TileSeed {
  const first = slots[0];
  if (!first || first.kind === "frame") return {};
  const source = first.source;
  if (!source || typeof source === "string") {
    return first.label ? { title: first.label } : {};
  }
  if (source.kind === "state") {
    return first.label ? { title: first.label } : {};
  }
  const device = devices.find((d) => d.id === source.device);
  if (!device) return first.label ? { title: first.label } : {};
  return {
    title: tileTitle(device) || undefined,
    size: resolveTemplate(device, templates).size,
    icon: presetGlyph(device.type),
  };
}
