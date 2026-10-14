import type { DeviceType } from "$lib/types/device";
import type { Slot, Template } from "$lib/types/display";
import { DEVICE_FEATURES } from "$lib/config/features";

/**
 * Frozen built-in templates — one per device type (spec §4.2). They are the
 * known-good baseline: editing one in the UI writes a *copy* (`basedOn`), so a
 * later fix here can still reach every device that never copied it.
 *
 * The icon slot's default glyph lives in `options.icon`; its `rules` override it
 * when a value matches (see `rule-ops`).
 */

const badge = (source: string, tone?: string): Slot => ({
  kind: "badge",
  source,
  ...(tone ? { tone } : {}),
});

const ago = badge("ago");
const offline = badge("offline");

const icon = (source: string, glyph: string, rules?: Slot["rules"]): Slot => ({
  kind: "icon",
  source,
  ...(rules ? { rules } : {}),
  options: { icon: glyph },
});

export const PRESETS: Record<DeviceType, Template> = {
  Switch: {
    id: "Switch",
    name: "Switch",
    builtin: true,
    type: "Switch",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Switch,
    slots: [
      icon("power", "power_settings_new"),
      { kind: "value", source: "power" },
      ago,
      offline,
    ],
  },
  Button: {
    id: "Button",
    name: "Button",
    builtin: true,
    type: "Button",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Button,
    slots: [
      icon("press", "touch_app"),
      { kind: "button", source: "press" },
      ago,
      offline,
    ],
  },
  Light: {
    id: "Light",
    name: "Light",
    builtin: true,
    type: "Light",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Light,
    slots: [
      icon("power", "lightbulb", [
        { when: "power", icon: "lightbulb", color: "amber", glow: true },
        { when: "!power", icon: "lightbulb_outline", color: "grey" },
      ]),
      { kind: "value", source: "power" },
      { kind: "level", source: "brightness" },
      { kind: "color", source: "color" },
      ago,
      offline,
    ],
  },
  Thermostat: {
    id: "Thermostat",
    name: "Thermostat",
    builtin: true,
    type: "Thermostat",
    size: { w: 2, h: 1 },
    features: DEVICE_FEATURES.Thermostat,
    slots: [
      icon("actual", "thermostat"),
      { kind: "value", source: "actual" },
      { kind: "level", source: "setpoint" },
      { kind: "enum", source: "mode" },
      ago,
      offline,
    ],
  },
  Thermometer: {
    id: "Thermometer",
    name: "Thermometer",
    builtin: true,
    type: "Thermometer",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Thermometer,
    slots: [
      icon("temperature", "device_thermostat"),
      { kind: "value", source: "temperature" },
      { kind: "value", source: "humidity" },
      ago,
      offline,
      badge("battery", "warn"),
    ],
  },
  Blind: {
    id: "Blind",
    name: "Blind",
    builtin: true,
    type: "Blind",
    size: { w: 2, h: 1 },
    features: DEVICE_FEATURES.Blind,
    slots: [
      icon("position", "blinds"),
      { kind: "level", source: "position" },
      { kind: "button", source: "stop" },
      offline,
    ],
  },
  Window: {
    id: "Window",
    name: "Window",
    builtin: true,
    type: "Window",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Window,
    slots: [
      icon("open", "window", [
        { when: "open", icon: "window_open", color: "amber" },
        { when: "!open", icon: "window_closed", color: "grey" },
      ]),
      { kind: "value", source: "open" },
      ago,
      offline,
    ],
  },
  Motion: {
    id: "Motion",
    name: "Motion",
    builtin: true,
    type: "Motion",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Motion,
    slots: [
      icon("motion", "sensors"),
      { kind: "value", source: "motion" },
      ago,
    ],
  },
  AC: {
    id: "AC",
    name: "AC",
    builtin: true,
    type: "AC",
    size: { w: 2, h: 2 },
    features: DEVICE_FEATURES.AC,
    slots: [
      icon("power", "ac_unit"),
      { kind: "level", source: "temperature" },
      { kind: "enum", source: "mode" },
      { kind: "level", source: "fan" },
      { kind: "value", source: "power" },
      ago,
      offline,
    ],
  },
  Value: {
    id: "Value",
    name: "Value",
    builtin: true,
    type: "Value",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Value,
    slots: [
      icon("value", "speed"),
      { kind: "value", source: "value" },
      ago,
      offline,
    ],
  },
  Custom: {
    id: "Custom",
    name: "Custom",
    builtin: true,
    type: "Custom",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Custom,
    slots: [
      icon("value", "widgets"),
      { kind: "value", source: "value" },
      { kind: "level", source: "level" },
      { kind: "button", source: "power" },
      offline,
    ],
  },
};
