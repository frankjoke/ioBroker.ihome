import { localizeName } from "$lib/config/format";
import { widgetFor } from "$lib/config/features";
import { glyphForRole, presetGlyph } from "$lib/config/icon-ops";
import {
  resolveControl,
  resolveTemplate,
  templateFeatures,
  tileTitle,
} from "$lib/config/template-ops";
import { effectiveCommon, widgetForMeta } from "$lib/config/state-meta";
import { autoFillTemplate } from "$lib/config/template-suggest";
import type { TemplateReference } from "$lib/config/template-reference";
import type { Control, Device, Widget } from "$lib/types/device";
import type {
  ActiveCondition,
  Background,
  Size,
  Slot,
  SlotKind,
  Template,
  TileConfig,
  TileLook,
} from "$lib/types/display";

/** The slot kinds that render a control widget: the live state's shape wins
 *  over a recipe's kind for these. */
const WIDGET_KINDS: SlotKind[] = [
  "value",
  "level",
  "switch",
  "color",
  "enum",
  "button",
];

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
  // The same role fallback the raw-state path uses: a control slot gets its
  // switch/light/… badge instead of a blank face, unless the object names one.
  const ownIcon =
    typeof meta.icon === "string" && meta.icon.trim()
      ? meta.icon.trim()
      : undefined;
  const glyph = ownIcon ?? glyphForRole(meta.role, meta.type);
  // No unit copy: the resolver returns the effective unit (and hideUnit).
  return {
    kind: slotKindForWidget(w),
    source: { kind: "control", device: device.id, control: control.id },
    ...(label ? { label } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(glyph ? { icon: { glyph } } : {}),
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
  const ownIcon =
    typeof common.icon === "string" && common.icon.trim()
      ? common.icon.trim()
      : undefined;
  const glyph = ownIcon ?? glyphForRole(common.role, common.type);
  return {
    kind,
    source: { kind: "state", stateId },
    ...(label ? { label } : {}),
    ...(common.unit ? { unit: common.unit } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(glyph ? { icon: { glyph } } : {}),
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
    const kind = WIDGET_KINDS.includes(slot.kind) ? base.kind : slot.kind;
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

/** A control that names real data: a state, a virtual or a formula. A control
 *  left empty by a template is not bound and never preselected. */
function isBoundControl(control: Control): boolean {
  return !!(
    control.stateId ||
    control.kind === "virtual" ||
    control.virtual ||
    control.formulaId
  );
}

/**
 * The controls a new tile starts with: every control that names real data.
 * Controls a template left empty (no state, no virtual/formula) are skipped.
 */
export function preselectedControlIds(device: Device): string[] {
  return (device.controls ?? [])
    .filter((c) => !c.hidden && isBoundControl(c))
    .map((c) => c.id);
}

/** What a brand-new tile inherits from its first slot: a name, the type's size
 *  and one default glyph. An offer frozen at creation, never a live link (S11). */
export interface TileSeed {
  title?: string;
  size?: Size;
  icon?: string;
  active?: ActiveCondition;
  look?: TileLook;
  background?: Background;
}

/** A template's active condition with its feature name bound to the control. */
function materializeActive(
  active: ActiveCondition | undefined,
  features: Set<string>,
  device: Device,
): ActiveCondition | undefined {
  if (!active) return undefined;
  if (typeof active.source !== "string") return active;
  if (!features.has(active.source)) return active;
  const control = resolveControl(device.controls ?? [], active.source);
  if (!control) return undefined;
  return {
    ...active,
    source: { kind: "control", device: device.id, control: control.id },
  };
}

/** A template's slots with feature names bound to the device's controls. */
function materializeSlots(template: Template, device: Device): Slot[] {
  const features = new Set(templateFeatures(template).map((f) => f.feature));
  const out: Slot[] = [];
  for (const slot of template.slots ?? []) {
    const source = typeof slot.source === "string" ? slot.source : "";
    const pick =
      typeof slot.options?.pick === "string" ? slot.options.pick : "";
    const hint = features.has(source) ? source : features.has(pick) ? pick : "";
    if (!hint) {
      out.push(slot);
      continue;
    }
    const [mapped] = suggestedSlots(device, [slot]);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Point a template's `ago` badge at the primary control (usually power). */
function materializeAgo(
  slots: Slot[],
  template: Template,
  device: Device,
): Slot[] {
  const features = templateFeatures(template);
  const primary = features.find((feature) => feature.primary) ?? features[0];
  const control =
    device.controls?.find((entry) => entry.feature === primary?.feature) ??
    device.controls?.[0];
  const keys = new Set(features.map((feature) => feature.feature));
  return slots.map((slot) => {
    if (slot.source !== "ago") return slot;
    const of = typeof slot.options?.of === "string" ? slot.options.of : "";
    const nextOf = of && keys.has(of) ? (control?.stateId ?? control?.id) : of;
    return {
      ...slot,
      options: {
        ...slot.options,
        ...(nextOf ? { of: nextOf } : {}),
        ...(slot.options?.from ? {} : { from: "lc" }),
      },
    };
  });
}

/** A complete tile for a device created from this template. */
export function materializeTemplateTile(
  template: Template,
  device: Device,
  templates: Template[],
): {
  slots: Slot[];
  active?: ActiveCondition;
  look?: TileLook;
  size?: Size;
  background?: Background;
  title?: string;
  icon?: string;
} {
  const slots = materializeAgo(
    materializeSlots(template, device),
    template,
    device,
  );
  const seed = tileSeed(slots, [device], templates);
  const active = materializeActive(
    template.active,
    new Set(templateFeatures(template).map((f) => f.feature)),
    device,
  );
  return {
    slots,
    ...seed,
    ...(template.active !== undefined ? { active } : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.background ? { background: template.background } : {}),
  };
}

/**
 * A complete tile for a state + template, with no device created: the same
 * slots as the device tile, bound to the broker states around the main one.
 */
export function materializeTemplateTileFromState(
  template: Template,
  main: TemplateReference,
  objects: Map<string, any>,
  anchorFeature?: string,
): {
  slots: Slot[];
  active?: ActiveCondition;
  look?: TileLook;
  size?: Size;
  background?: Background;
  title?: string;
  icon?: string;
} {
  const features = templateFeatures(template);
  const byName = new Map(features.map((feature) => [feature.feature, feature]));
  const { fills } = autoFillTemplate(template, main, objects, anchorFeature);
  const filled = new Map<string, TemplateReference>();
  for (const fill of fills) {
    if (!fill.ref || !fill.object) continue;
    filled.set(fill.feature.feature, {
      ref: fill.ref,
      stateId: fill.stateId ?? fill.ref,
      object: fill.object,
    });
  }

  const slots: Slot[] = [];
  for (const slot of template.slots ?? []) {
    const source = typeof slot.source === "string" ? slot.source : "";
    const pick =
      typeof slot.options?.pick === "string" ? slot.options.pick : "";
    const hint = byName.has(source) ? source : byName.has(pick) ? pick : "";
    if (!hint) {
      slots.push(slot);
      continue;
    }
    const entry = filled.get(hint);
    if (!entry) continue;
    const def = byName.get(hint)!;
    const kind = WIDGET_KINDS.includes(slot.kind)
      ? slotKindForWidget(widgetForMeta(entry.object?.common ?? {}, def.widget))
      : slot.kind;
    const base = slotFromState(entry.ref, entry.object, kind);
    const options: Record<string, unknown> = { ...(base.options ?? {}) };
    for (const [key, value] of Object.entries(slot.options ?? {})) {
      if (key !== "pick" && value !== undefined) options[key] = value;
    }
    slots.push({
      ...base,
      ...slot,
      kind,
      source: base.source,
      // Same caption the device tile gets: the recipe's, else the feature's.
      label: slot.label ?? def.label,
      unit: slot.unit ?? base.unit,
      ...(Object.keys(options).length ? { options } : { options: undefined }),
    });
  }

  // The ago badge tracks the main control, exactly as the device tile does.
  const primary = features.find((feature) => feature.primary) ?? features[0];
  const mainRef = (primary && filled.get(primary.feature)?.ref) ?? main.ref;
  const bound = slots.map((slot) =>
    slot.source === "ago"
      ? {
          ...slot,
          options: {
            ...slot.options,
            of: mainRef,
            ...(slot.options?.from ? {} : { from: "lc" }),
          },
        }
      : slot,
  );

  const activeSource = template.active?.source;
  const activeFill =
    typeof activeSource === "string" ? filled.get(activeSource) : undefined;
  const name = localizeName(main.object?.common?.name);
  const glyph = bound[0]?.icon?.glyph ?? presetGlyph(template.type);
  return {
    slots: bound,
    ...(activeFill && template.active
      ? {
          active: {
            ...template.active,
            source: { kind: "state", stateId: activeFill.ref },
          },
        }
      : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.size ? { size: template.size } : {}),
    ...(template.background ? { background: template.background } : {}),
    ...(name ? { title: name } : {}),
    ...(glyph ? { icon: glyph } : {}),
  };
}

/** The tile config a materialised template produces (a new tile or an applied
 *  template), so the two callers cannot drift. */
export function materializedTileConfig(
  materialized: ReturnType<typeof materializeTemplateTile>,
): TileConfig {
  const tile: TileConfig = {
    slots: materialized.slots,
    ...(materialized.size ? { size: materialized.size } : {}),
    ...(materialized.background ? { background: materialized.background } : {}),
    ...(materialized.active ? { active: materialized.active } : {}),
    ...(materialized.look ? { look: materialized.look } : {}),
  };
  if (materialized.icon) {
    tile.look = {
      ...tile.look,
      inactive: {
        ...tile.look?.inactive,
        glyph: tile.look?.inactive?.glyph ?? materialized.icon,
      },
    };
  }
  return tile;
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
  const typeGlyph = presetGlyph(device.type);
  const resolved = resolveTemplate(device, templates);
  const features = new Set(resolved.features.map((f) => f.feature));
  const active = materializeActive(resolved.active, features, device);
  return {
    title: tileTitle(device) || undefined,
    size: resolved.size,
    // A Custom device has no face of its own: the first control's glyph is the
    // meaningful one, not the type preset's generic "widgets" placeholder.
    icon:
      device.type === "Custom" ? (first.icon?.glyph ?? typeGlyph) : typeGlyph,
    ...(active ? { active } : {}),
    ...(resolved.look ? { look: resolved.look } : {}),
    ...(resolved.background ? { background: resolved.background } : {}),
  };
}

/** Merge a template's tile defaults into a new placement. */
export function applyTileSeed(tile: TileConfig, seed: TileSeed): TileConfig {
  const look = seed.look
    ? {
        ...seed.look,
        ...tile.look,
        ...(seed.look.active || tile.look?.active
          ? { active: { ...seed.look.active, ...tile.look?.active } }
          : {}),
        ...(seed.look.inactive || tile.look?.inactive
          ? { inactive: { ...seed.look.inactive, ...tile.look?.inactive } }
          : {}),
      }
    : tile.look;
  return {
    ...tile,
    ...(tile.size ? {} : seed.size ? { size: seed.size } : {}),
    ...(tile.background
      ? {}
      : seed.background
        ? { background: seed.background }
        : {}),
    ...(tile.active ? {} : seed.active ? { active: seed.active } : {}),
    ...(look ? { look } : {}),
  };
}
