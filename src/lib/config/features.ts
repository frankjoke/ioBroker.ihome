import type { DeviceType, Widget } from "$lib/types/device";

export const DEVICE_TYPES: DeviceType[] = [
  "Switch",
  "Button",
  "Light",
  "Thermostat",
  "Blind",
  "Window",
  "AC",
  "Thermometer",
  "Motion",
  "Value",
  "Custom",
];

export interface FeatureDef {
  feature: string;
  label: string;
  widget: Widget;
  roleHints: string[];
  /** A template may insist a device of its type supplies this feature. */
  required?: boolean;
}

export const DEVICE_FEATURES: Record<DeviceType, FeatureDef[]> = {
  Switch: [
    {
      feature: "power",
      label: "Power",
      widget: "switch",
      roleHints: ["switch", "power"],
    },
  ],
  Button: [
    {
      feature: "press",
      label: "Press",
      widget: "button",
      roleHints: ["button"],
    },
  ],
  Light: [
    {
      feature: "power",
      label: "Power",
      widget: "switch",
      roleHints: ["switch", "power"],
    },
    {
      feature: "brightness",
      label: "Brightness",
      widget: "level",
      roleHints: ["level", "dimmer", "brightness"],
    },
    {
      feature: "color",
      label: "Color",
      widget: "color",
      roleHints: ["color", "hue", "rgb"],
    },
    {
      feature: "colorTemp",
      label: "Color Temp",
      widget: "level",
      roleHints: ["colortemp", "color.temperature"],
    },
  ],
  Thermostat: [
    {
      feature: "actual",
      label: "Actual",
      widget: "value",
      roleHints: ["temperature", "value.temperature"],
    },
    {
      feature: "setpoint",
      label: "Setpoint",
      widget: "level",
      roleHints: ["setpoint", "level.temperature"],
    },
    {
      feature: "mode",
      label: "Mode",
      widget: "enum",
      roleHints: ["mode", "thermostat.mode"],
    },
  ],
  Blind: [
    {
      feature: "position",
      label: "Position",
      widget: "level",
      roleHints: ["level.blind", "level.curtain", "blind", "position"],
    },
    {
      feature: "stop",
      label: "Stop",
      widget: "button",
      roleHints: ["button.stop", "blind.stop"],
    },
  ],
  Window: [
    {
      feature: "open",
      label: "Open",
      widget: "switch",
      roleHints: ["window", "sensor.window", "switch"],
    },
  ],
  AC: [
    {
      feature: "power",
      label: "Power",
      widget: "switch",
      roleHints: ["switch", "power"],
    },
    {
      feature: "mode",
      label: "Mode",
      widget: "enum",
      roleHints: ["mode", "ac.mode"],
    },
    {
      feature: "temperature",
      label: "Temperature",
      widget: "level",
      roleHints: ["level.temperature", "temperature"],
    },
    {
      feature: "fan",
      label: "Fan",
      widget: "level",
      roleHints: ["level.speed", "fan"],
    },
  ],
  Thermometer: [
    {
      feature: "temperature",
      label: "Temperature",
      widget: "value",
      roleHints: ["temperature", "value.temperature"],
    },
    {
      feature: "humidity",
      label: "Humidity",
      widget: "value",
      roleHints: ["humidity", "value.humidity"],
    },
  ],
  Motion: [
    {
      feature: "motion",
      label: "Motion",
      widget: "switch",
      roleHints: ["motion"],
    },
  ],
  Value: [
    {
      feature: "value",
      label: "Value",
      widget: "value",
      roleHints: ["value", "state"],
    },
  ],
  Custom: [
    {
      feature: "value",
      label: "Value",
      widget: "value",
      roleHints: ["value", "state"],
    },
    {
      feature: "power",
      label: "Power",
      widget: "switch",
      roleHints: ["switch", "power"],
    },
    { feature: "level", label: "Level", widget: "level", roleHints: ["level"] },
  ],
};

export function featureDef(
  deviceType: DeviceType,
  feature: string,
): FeatureDef | undefined {
  return DEVICE_FEATURES[deviceType]?.find((f) => f.feature === feature);
}

export function widgetFor(deviceType: DeviceType, feature: string): Widget {
  return featureDef(deviceType, feature)?.widget ?? "value";
}

function levelNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * What a level slider allows: the effective metadata's min/max/step, else a
 * slot range that fills a gap (a copied or hand-set value), else 0/100/1. A
 * step must be positive to be usable.
 */
export function levelRange(
  common: Record<string, unknown> = {},
  options: Record<string, unknown> = {},
): { min: number; max: number; step: number } {
  const slotStep = levelNumber(options.step);
  const commonStep = levelNumber(common.step);
  return {
    min: levelNumber(common.min) ?? levelNumber(options.min) ?? 0,
    max: levelNumber(common.max) ?? levelNumber(options.max) ?? 100,
    step:
      commonStep !== undefined && commonStep > 0
        ? commonStep
        : slotStep !== undefined && slotStep > 0
          ? slotStep
          : 1,
  };
}

/** Default device name: `Room.Type` (+ `.Superstate` when disambiguating). */
export function suggestDeviceName(
  type: DeviceType,
  roomLabel: string,
  superstateName: string,
  disambiguate: boolean,
): string {
  const base = roomLabel ? `${roomLabel}.${type}` : type;
  return disambiguate && superstateName ? `${base}.${superstateName}` : base;
}

/** Default label from a state's role tail, capitalised (value.humidity → Humidity). */
export function roleLabel(obj: any): string {
  const role = String(obj?.common?.role ?? "");
  if (!role) return "";
  const tail = role.split(".").pop() ?? "";
  return tail ? tail[0].toUpperCase() + tail.slice(1) : "";
}

const ROLE_TYPE_RULES: { test: RegExp; type: DeviceType }[] = [
  { test: /button|taste/, type: "Button" },
  { test: /light|dimmer|lamp/, type: "Light" },
  { test: /blind|curtain|shutter/, type: "Blind" },
  { test: /window/, type: "Window" },
  { test: /motion/, type: "Motion" },
  { test: /thermostat|setpoint|level\.temperature/, type: "Thermostat" },
  { test: /aircondition|aircon|climate/, type: "AC" },
  { test: /temperature|humidity|thermometer/, type: "Thermometer" },
  { test: /switch|button|power/, type: "Switch" },
];

/**
 * Suggest a device type from a state object and (optionally) its parent
 * objects — the first matching role wins, then a type-based fallback.
 */
export function suggestDeviceType(obj: any, ancestors: any[] = []): DeviceType {
  const roles = [obj, ...ancestors]
    .map((o) => String(o?.common?.role ?? ""))
    .filter(Boolean);
  for (const rule of ROLE_TYPE_RULES) {
    if (roles.some((r) => rule.test.test(r))) return rule.type;
  }
  const type = String(obj?.common?.type ?? "");
  if (type === "boolean") return "Switch";
  if (type === "number") return "Value";
  return "Custom";
}

/** Suggest a feature for a state object based on its common.role / common.type. */
export function suggestFeature(
  obj: any,
  deviceType: DeviceType,
): string | undefined {
  const role = String(obj?.common?.role ?? "");
  const type = String(obj?.common?.type ?? "");
  for (const def of DEVICE_FEATURES[deviceType] ?? []) {
    if (def.roleHints.some((h) => role.includes(h) || type.includes(h))) {
      return def.feature;
    }
  }
  return type === "boolean" ? "power" : "value";
}

/**
 * The feature a control should carry for its device type: the current one when
 * the type defines it, else the state's suggestion for that type, else the
 * type's first feature. `suggestFeature` alone can hand back a feature the
 * final type does not have (a new device starts as Custom, whose boolean
 * fallback is "power" — then the type is inferred as Button, whose only feature
 * is "press", and a template slot for "press" finds nothing).
 */
export function featureForType(
  type: DeviceType,
  feature: string | undefined,
  obj?: any,
): string {
  if (feature && featureDef(type, feature)) return feature;
  const suggested = suggestFeature(obj, type);
  if (suggested && featureDef(type, suggested)) return suggested;
  return DEVICE_FEATURES[type]?.[0]?.feature ?? "value";
}
