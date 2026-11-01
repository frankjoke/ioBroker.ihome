// The icon an ioBroker object carries, and the icon a device inherits from the
// objects behind its controls (A65). Pure: the caller passes the object map, so
// nothing here touches the socket, the DOM or a store.

import type { DeviceType } from "$lib/types/device";
import { PRESETS } from "$lib/config/presets";
import { iconSrc, isImageIcon, ownerOf } from "$lib/utils/icon-url";

const FIELDS = ["modelIcon", "extIcon", "icon"] as const;

/** Infrastructure objects carry a page/adapter logo, not a device's face: skip
 *  them while walking a state's path (0_userdata.0 is a `meta` root with the
 *  page icon; ihome.0 is an instance with the adapter icon). */
const INFRASTRUCTURE_TYPES = new Set(["meta", "instance", "adapter"]);

/** The first icon field an object carries, in A65's order. */
export function objectIconValue(
  obj: unknown,
): { field: (typeof FIELDS)[number]; value: string } | undefined {
  const common = (obj as { common?: Record<string, unknown> } | undefined)
    ?.common;
  for (const field of FIELDS) {
    const value = common?.[field];
    if (typeof value === "string" && value.trim()) {
      return { field, value: value.trim() };
    }
  }
  return undefined;
}

/**
 * The icon an object id resolves to (A65): walk the id's own path upward and
 * take the nearest object that carries any icon field; with none, the adapter —
 * its instance first, then the package.
 */
export function resolveIcon(
  objects: Map<string, any>,
  id: string,
): { from: string; value: string } | undefined {
  let cur = String(id ?? "");
  while (cur) {
    const obj = objects.get(cur);
    const hit =
      obj && !INFRASTRUCTURE_TYPES.has(String(obj.type))
        ? objectIconValue(obj)
        : undefined;
    if (hit) return { from: cur, value: hit.value };
    const cut = cur.lastIndexOf(".");
    if (cut < 0) break;
    cur = cur.slice(0, cut);
  }
  const { adapter, instance } = ownerOf(id);
  if (!adapter) return undefined;
  const candidates = instance
    ? [`system.adapter.${adapter}.${instance}`, `system.adapter.${adapter}`]
    : [`system.adapter.${adapter}`];
  for (const candidate of candidates) {
    const hit = objectIconValue(objects.get(candidate));
    if (hit) return { from: candidate, value: hit.value };
  }
  return undefined;
}

/** The device's icon: the first of its controls whose reading resolves (A65). */
export function deviceObjectIcon(
  objects: Map<string, any>,
  stateIds: (string | undefined)[],
): { from: string; value: string } | undefined {
  for (const stateId of stateIds) {
    if (!stateId) continue;
    const hit = resolveIcon(objects, stateId);
    if (hit) return hit;
  }
  return undefined;
}

/** Default glyphs for the ioBroker roles, so a tile built from a bare state has
 *  a face instead of a blank slot. Ordered: the first match wins. */
const ROLE_GLYPHS: [RegExp, string][] = [
  [/switch|socket|plug|outlet/i, "power_settings_new"],
  [/button|press/i, "touch_app"],
  [/motion|presence/i, "directions_walk"],
  [/door|window|contact/i, "sensor_door"],
  [/light|lamp/i, "lightbulb"],
  [/temperature/i, "thermostat"],
  [/humidity|moisture/i, "water_drop"],
  [/battery/i, "battery_full"],
  [/power|energy|consumption/i, "bolt"],
  [/level|dimmer|brightness/i, "brightness_6"],
  [/color/i, "palette"],
  [/volume|audio/i, "volume_up"],
  [/position|blind|shutter/i, "blinds"],
  [/lock/i, "lock"],
  [/co2|air|quality/i, "air"],
  [/illuminance|lux/i, "light_mode"],
  [/pressure/i, "compress"],
];

/** The glyph a role suggests; a harmless fallback for a bare boolean. */
export function glyphForRole(
  role: unknown,
  type?: unknown,
): string | undefined {
  const text = String(role ?? "");
  for (const [pattern, glyph] of ROLE_GLYPHS) {
    if (pattern.test(text)) return glyph;
  }
  return type === "boolean" ? "toggle_on" : undefined;
}

/** The glyph a type's preset puts on its headline slot — the tile's look icon. */
export function presetGlyph(type: DeviceType): string | undefined {
  for (const slot of PRESETS[type]?.slots ?? []) {
    const glyph = slot.icon?.glyph;
    if (glyph) return glyph;
  }
  return undefined;
}

/**
 * A device's face: its own icon, else a real object icon, else the type's preset
 * glyph instead of the bare adapter fallback. A variable-created state carries
 * no icon of its own, so the adapter logo (iHome / 0_userdata) would be shown —
 * uninformative, and not what the tile's look shows.
 */
export function deviceFaceIcon(
  own: string | undefined,
  iconHit: { from: string; value: string } | undefined,
  type: DeviceType,
): string | undefined {
  if (own) return own;
  if (iconHit && !iconHit.from.startsWith("system.adapter.")) {
    return iconSrc(iconHit.value, iconHit.from);
  }
  return (
    presetGlyph(type) ??
    (iconHit ? iconSrc(iconHit.value, iconHit.from) : undefined)
  );
}

/**
 * The **portable** form of a broker icon for a document (A66): a bare filename
 * gains the adapter that owns it (`adapter/<adapter>/<file>`), which is the
 * ioBroker-root-relative path `iconSrc` later resolves against whatever host is
 * configured. Absolutes, data URIs, symbols and already-prefixed paths are left
 * alone; so is a leading `/` (a root path with nothing to prefix).
 */
export function brokerIconPath(value: string, ownerId: string): string {
  const icon = String(value ?? "").trim();
  if (!icon) return "";
  // A symbol name is not a path; absolutes, data URIs and already-prefixed
  // paths have nothing to prefix.
  if (!isImageIcon(icon)) return icon;
  if (/^(https?:)?\/\//i.test(icon) || /^data:/i.test(icon)) return icon;
  if (icon.startsWith("adapter/") || icon.startsWith("/")) return icon;
  const adapter = ownerOf(ownerId).adapter;
  return adapter ? `adapter/${adapter}/${icon}` : icon;
}
