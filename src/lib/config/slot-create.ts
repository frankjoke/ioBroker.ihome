import { localizeName } from "$lib/config/format";
import { widgetFor } from "$lib/config/features";
import { resolveControl } from "$lib/config/template-ops";
import type { Control, Device, Widget } from "$lib/types/device";
import type { Slot, SlotKind } from "$lib/types/display";

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
  control: Control,
  widget?: Widget,
): Slot {
  const common = control.common ?? {};
  const w = widget ?? widgetFor(device.type, control.feature);
  const options = rangeOptions(common);
  const label = control.label ?? (localizeName(common.name) || undefined);
  const unit = control.unit ?? common.unit;
  return {
    kind: slotKindForWidget(w),
    source: { kind: "control", device: device.id, control: control.id },
    ...(label ? { label } : {}),
    ...(unit ? { unit } : {}),
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
    const kind =
      slot.kind === "value" && widget !== "value"
        ? slotKindForWidget(widget)
        : slot.kind;
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
