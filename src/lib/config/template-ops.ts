import type { Device, DeviceType } from "$lib/types/device";
import type { FeatureDef } from "$lib/config/features";
import type { Size, Slot, Template } from "$lib/types/display";
import type { TemplateRegistry } from "$lib/types/display";
import { PRESETS } from "$lib/config/presets";
import { DEFAULT_SPAN } from "$lib/config/size-ops";
import { num, parseDoc } from "$lib/config/doc-parse";

export { PRESETS };

export interface ResolvedTemplate {
  type: DeviceType;
  size: Size;
  features: FeatureDef[];
  slots: Slot[];
}

/** Slot identity: one slot per kind+source, so a later layer can override it. */
function slotKey(slot: Slot): string {
  return `${slot.kind}:${slot.source ?? ""}`;
}

/**
 * Merge slot layers in order (preset → template → device). A later layer
 * overrides the fields it sets on a slot it shares a `(kind, source)` key with,
 * and its rules are appended — so conditions accumulate rather than clobber.
 */
export function mergeSlots(layers: Slot[][]): Slot[] {
  const order: string[] = [];
  const byKey = new Map<string, Slot>();
  for (const layer of layers) {
    for (const slot of layer ?? []) {
      const key = slotKey(slot);
      const prev = byKey.get(key);
      if (!prev) {
        order.push(key);
        byKey.set(key, { ...slot });
        continue;
      }
      const rules = [...(prev.rules ?? []), ...(slot.rules ?? [])];
      byKey.set(key, {
        ...prev,
        ...slot,
        ...(rules.length ? { rules } : {}),
      });
    }
  }
  return order.map((key) => byKey.get(key)!);
}

/** The user template with this id, if any. */
export function templateById(
  id: string | undefined,
  templates: Template[],
): Template | undefined {
  if (!id) return undefined;
  return templates.find((t) => t.id === id);
}

/**
 * Never returns undefined: an unknown type — or a `basedOn` naming a preset
 * that no longer exists — degrades to `Custom`, so a stale id leaves a working
 * tile instead of a blank one.
 */
export function presetForType(type: string | undefined): Template {
  return PRESETS[type as DeviceType] ?? PRESETS.Custom;
}

/**
 * What a device renders as: the type preset, the device's user template on top,
 * then the device's own slot overrides.
 */
export function resolveTemplate(
  device: Device,
  userTemplates: Template[],
): ResolvedTemplate {
  const user = templateById(device.template, userTemplates);
  const base = presetForType(user?.basedOn ?? device.type);
  return {
    type: device.type,
    size: device.size ?? user?.size ?? base.size ?? DEFAULT_SPAN,
    features: user?.features?.length ? user.features : base.features,
    slots: mergeSlots([base.slots, user?.slots ?? [], device.slots ?? []]),
  };
}

/**
 * The control a tile body acts on: a writable switch toggles, a level opens the
 * modal. Anything else is left to the modal alone.
 */
export function primaryControl<
  T extends { widget?: string; writable?: boolean },
>(controls: T[]): T | undefined {
  return (
    controls.find((c) => c.writable === true && c.widget === "switch") ??
    controls.find((c) => c.widget === "level")
  );
}

/** Read a persisted user-template registry; null when there is nothing usable. */
export function parseTemplateRegistry(raw: unknown): TemplateRegistry | null {
  return parseDoc(raw, (value) => {
    const templates = value.templates;
    if (!Array.isArray(templates)) return null;
    return {
      version: num(value.version, 0),
      updatedAt: num(value.updatedAt, Date.now()),
      templates: templates as Template[],
    };
  });
}
