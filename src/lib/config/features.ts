import type { DeviceType, Widget } from "$lib/types/device";

export const DEVICE_TYPES: DeviceType[] = [
  "Switch",
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
