import type { Device, DeviceType } from "$lib/types/device";
import type { FeatureDef } from "$lib/config/features";
import type { Size, Slot, Template } from "$lib/types/display";
import type { TemplateRegistry } from "$lib/types/display";
import { PRESETS } from "$lib/config/presets";
import {
  DEFAULT_SPAN,
  clampSpan,
  type Breakpoint,
  type TileSpan,
} from "$lib/config/size-ops";
import { num, parseDoc } from "$lib/config/doc-parse";

export { PRESETS };

export interface ResolvedTemplate {
  type: DeviceType;
  size: Size;
  features: FeatureDef[];
  slots: Slot[];
}

/**
 * Slot identity: one slot per kind+source, plus `options.index` so a preset can
 * declare *several* readout slots of the same kind ("show two values") and still
 * have each one addressable by a later layer.
 */
function slotKey(slot: Slot): string {
  const index = slot.options?.index;
  const suffix = typeof index === "number" ? `:${index}` : "";
  return `${slot.kind}:${slot.source ?? ""}${suffix}`;
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
  // A device may name a user template *or* a built-in preset (spec §4).
  return (
    templates.find((t) => t.id === id) ??
    (PRESETS as Record<string, Template>)[id]
  );
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
  const chosen = templateById(device.template, userTemplates);
  // Only a *user* template contributes its own layer; a chosen preset already is
  // the base (merging it twice would duplicate every rule).
  const user = chosen?.builtin ? undefined : chosen;
  const base = presetForType(user?.basedOn ?? chosen?.type ?? device.type);
  return {
    type: device.type,
    size: device.size ?? user?.size ?? base.size ?? DEFAULT_SPAN,
    features: user?.features?.length ? user.features : base.features,
    slots: mergeSlots([base.slots, user?.slots ?? [], device.slots ?? []]),
  };
}

/**
 * The name a tile shows. Device names default to `Room.Type` (see
 * `suggestDeviceName`), so the type suffix is redundant *on a tile that is already
 * shaped by its type* — "Garten-Pool.Light" reads as "Garten-Pool". An explicit
 * `Device.title` (set in the device config) always wins.
 */
export function tileTitle(device: {
  name?: string;
  type?: string;
  title?: string;
}): string {
  const explicit = String(device?.title ?? "").trim();
  if (explicit) return explicit;
  const name = String(device?.name ?? "");
  const type = String(device?.type ?? "");
  if (!type) return name;
  const suffix = `.${type}`;
  if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
    return name.slice(0, -suffix.length);
  }
  return name;
}

/** What a `pick` hint looks for, in the order the signals are trusted. */
const PICK_HINTS: Record<
  string,
  { roles: string[]; words: string[]; units: string[] }
> = {
  temperature: {
    roles: ["temperature"],
    words: ["temp"],
    units: ["°c", "°f", "k"],
  },
  humidity: {
    roles: ["humidity"],
    words: ["feucht", "humid"],
    units: ["%"],
  },
  power: { roles: ["power"], words: ["leistung", "power"], units: ["w", "kw"] },
  energy: {
    roles: ["energy", "consumption"],
    words: ["verbrauch", "energy"],
    units: ["wh", "kwh"],
  },
  battery: { roles: ["battery"], words: ["batterie", "battery"], units: [] },
};

export interface Pickable {
  id?: string;
  role?: string;
  unit?: string;
  label?: string;
}

/**
 * The control a readout *hint* wants — `temperature`, `humidity`, `power`, … —
 * independent of where it sits in the device's control order and of what the
 * device calls it.
 *
 * The signals are trusted in this order: the ioBroker **role** (your broker
 * carries `value.temperature` / `value.humidity`), then the **label** (which may
 * be German: "Luftfeuchtigkeit"), then the **unit**. An unknown hint becomes a
 * free-text search over the same signals ("Temperatur Außen"), so any label the
 * config carries can be named; nothing matched means the caller decides (a
 * source/hint slot goes dormant, never positional — A20).
 */
export function pickControl<T extends Pickable>(
  controls: T[],
  hint: string | undefined,
  used: Set<string>,
): T | undefined {
  const text = hint?.trim();
  if (!text) return undefined;
  const key = text.toLowerCase();
  const spec = PICK_HINTS[key] ?? { roles: [key], words: [key], units: [] };
  const free = (controls ?? []).filter((c) => !used.has(String(c.id ?? "")));
  const has = (haystack: unknown, needles: string[]) => {
    const text = String(haystack ?? "").toLowerCase();
    return needles.some((n) => text.includes(n));
  };
  // A unit is compared *exactly*: "Wh" must not satisfy a watt, and "%" is
  // humidity only once the role and label passes have had their say.
  const unitIs = (c: T) =>
    spec.units.includes(
      String(c.unit ?? "")
        .trim()
        .toLowerCase(),
    );
  return (
    free.find((c) => has(c.role, spec.roles)) ??
    free.find((c) => has(c.label, spec.words)) ??
    free.find(unitIs)
  );
}

/** May this slot render, given the tile's state? Unknown values count as both. */
export function slotVisible(slot: Slot, active: boolean): boolean {
  if (slot.showWhen === "active") return active;
  if (slot.showWhen === "inactive") return !active;
  return true;
}

/** The shape a hint matches against: role, then label, then unit. */
export interface PickableControl extends Pickable {
  feature?: string;
  object?: { common?: { role?: string } };
  common?: { role?: string };
}

export function pickable<T extends PickableControl>(controls: T[]): Pickable[] {
  return (controls ?? []).map((c) => ({
    id: c.id,
    role: c.object?.common?.role ?? c.common?.role,
    unit: c.unit,
    label: c.label ?? c.feature,
  }));
}

export interface PickedSlot<T> {
  slot: Slot;
  control?: T;
  /** The slot named a source or a hint and nothing matched (A20) — never
   *  positional, because a wrong reading is worse than a missing one. */
  dormant?: boolean;
}

/**
 * One pass over a tile's slots in order: state-hidden slots drop out first (they
 * must not claim "the next free control"), then `source`, then a hint, then the
 * next control no earlier slot used. `options.raw` supplies the pseudo-control
 * for a source that is a raw state id. Badge slots are skipped — badges live in
 * the corners.
 */
export function pickSlotControls<T extends PickableControl>(
  slots: Slot[],
  controls: T[],
  options?: { active?: boolean; raw?: (source: string) => T | undefined },
): PickedSlot<T>[] {
  const list = controls ?? [];
  const used = new Set<string>();
  const out: PickedSlot<T>[] = [];
  for (const slot of slots ?? []) {
    if (slot.kind === "badge") continue;
    if (!slotVisible(slot, options?.active === true)) continue;

    if (slot.source) {
      const control =
        resolveControl(list, slot.source) ?? options?.raw?.(slot.source);
      if (!control) {
        out.push({ slot, dormant: true });
        continue;
      }
      used.add(String(control.id ?? ""));
      out.push({ slot, control });
      continue;
    }

    const hint = String(slot.options?.pick ?? "");
    let control: T | undefined;
    if (hint.trim()) {
      const picked = pickControl(pickable(list), hint, used);
      control = picked ? list.find((c) => c.id === picked.id) : undefined;
      // A hint that matched nothing is dormant; position is never its fallback.
      if (!control) {
        out.push({ slot, dormant: true });
        continue;
      }
    } else {
      control = list.find((c) => !used.has(String(c.id ?? "")));
    }
    if (control) used.add(String(control.id ?? ""));
    out.push({ slot, control });
  }
  return out;
}

/**
 * Which control a slot's `source` points at (spec §4.1), most specific first:
 * the control's feature, its id, its state id, and — last resort, because real
 * device configs name a state by its label ("Motion") — its label.
 *
 * Label matching is a fallback, never a preference: a feature match always wins,
 * so a renaming in the config can only ever add a match, not steal one.
 */
export function resolveControl<
  T extends { feature?: string; id?: string; stateId?: string; label?: string },
>(controls: T[], source: string | undefined): T | undefined {
  if (!source) return undefined;
  const list = controls ?? [];
  const byLabel = (t: T) =>
    String(t.label ?? "").toLowerCase() === source.toLowerCase();
  return (
    list.find((c) => c.feature === source) ??
    list.find((c) => c.id === source) ??
    list.find((c) => c.stateId === source) ??
    list.find(byLabel)
  );
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
function isTemplateEntry(v: unknown): v is Template {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === "string" && !!t.id;
}

export function parseTemplateRegistry(raw: unknown): TemplateRegistry | null {
  return parseDoc(raw, (value) => {
    const templates = value.templates;
    if (!Array.isArray(templates)) return null;
    if (!templates.every(isTemplateEntry)) return null;
    return {
      version: num(value.version, 0),
      updatedAt: num(value.updatedAt, Date.now()),
      templates: templates as Template[],
    };
  });
}

/**
 * The size a tile actually renders at: its placement's own size when it has one,
 * else its template's, clamped per breakpoint.
 *
 * The renderer, the section layout pass and the editor's size selectors must all
 * use this one calculation — they drifted apart once, and a section was sized for
 * a width its tiles no longer had.
 */
export function effectiveSpan(
  tile: { size?: Size } | undefined,
  device: unknown,
  templates: Template[],
  bp: Breakpoint,
): TileSpan {
  return clampSpan(
    tile?.size ?? resolveTemplate(device as Device, templates).size,
    bp,
  );
}
