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
  // `tone` is a *rule* field, not a slot field: express it as one so the badge
  // renderer actually sees it.
  ...(tone ? { rules: [{ when: "true", tone }] } : {}),
});

const ago = badge("ago");
/** "How long since the last motion" — not since the battery last reported. */
const agoSince = (of: string, from: "ts" | "lc" = "lc"): Slot => ({
  kind: "badge",
  source: "ago",
  options: { of, from },
});
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
      icon("power", "power_settings_new", [
        { when: "truthy(power)", color: "var(--primary-color)" },
        {
          when: "!truthy(power)",
          color: "var(--text-muted)",
          disabled: true,
        },
      ]),
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
      // `truthy(...)`: power arrives as true, 1, "1" or "true" depending on the
      // adapter. Colours are theme tokens — "amber" is not a CSS colour.
      icon("power", "lightbulb", [
        {
          when: "truthy(power)",
          icon: "lightbulb",
          color: "var(--warning-color)",
          glow: true,
        },
        {
          when: "!truthy(power)",
          icon: "lightbulb_outline",
          color: "var(--text-muted)",
          disabled: true,
        },
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
      // Positional values: the tile shows the device's readings in order, which
      // works whatever the controls are called ("Temperatur", "Luftfeuchtigkeit")
      // and whatever feature they carry.
      icon("temperature", "device_thermostat"),
      { kind: "value", options: { index: 1 } },
      { kind: "value", options: { index: 2 } },
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
        {
          when: "truthy(open)",
          icon: "window_open",
          color: "var(--warning-color)",
        },
        {
          when: "!truthy(open)",
          icon: "window_closed",
          color: "var(--text-muted)",
          disabled: true,
        },
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
      // Idle is dimmed ("disabled") rather than invisible, and the value slot
      // reads On/Off so the tile says what it is doing.
      icon("motion", "sensors", [
        {
          when: "truthy(motion)",
          icon: "directions_run",
          color: "var(--primary-color)",
        },
        {
          when: "!truthy(motion)",
          icon: "directions_walk",
          color: "var(--text-muted)",
          disabled: true,
        },
      ]),
      { kind: "value", source: "motion" },
      agoSince("motion"),
      offline,
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
    slots: [icon("value", "speed"), { kind: "value" }, ago, offline],
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
