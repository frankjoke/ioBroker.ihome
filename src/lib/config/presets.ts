import type { DeviceType } from "$lib/types/device";
import type { Slot, Template } from "$lib/types/display";
import { DEVICE_FEATURES } from "$lib/config/features";

/**
 * Frozen built-in templates — one per device type (spec §4.2). They are the
 * known-good baseline: editing one in the UI writes a *copy* (`basedOn`), so a
 * later fix here can still reach every device that never copied it.
 *
 * A slot's own icon (A51) lives in `icon.glyph` — these presets enable it on
 * their headline slot (the first value slot, else the first slot) — and the
 * slot's `rules` override it when a value matches (see `rule-ops`).
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

export const PRESETS: Record<DeviceType, Template> = {
  Switch: {
    id: "Switch",
    name: "Switch",
    builtin: true,
    type: "Switch",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Switch,
    slots: [
      // A switch glows green when it is on (a light glows amber): the accent is
      // the headline slot's resolved colour, so this rule colours both — the
      // icon included, it lives on this slot now (A51/A52).
      {
        kind: "value",
        source: "power",
        icon: { glyph: "power_settings_new" },
        rules: [
          { when: "truthy(power)", color: "var(--success-color)", glow: true },
          {
            when: "!truthy(power)",
            color: "var(--text-muted)",
            disabled: true,
          },
        ],
      },
      // The watts, in the top-left reading corner — a switch's second question
      // after "is it on".
      { kind: "badge", options: { pick: "power" } },
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
      { kind: "button", source: "press", icon: { glyph: "touch_app" } },
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
      {
        kind: "value",
        source: "power",
        icon: { glyph: "lightbulb" },
        rules: [
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
        ],
      },
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
      { kind: "value", source: "actual", icon: { glyph: "thermostat" } },
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
      // Temperature first, humidity second — picked by role, so every
      // thermometer reads the same way whatever its control order is. Anything
      // else the device has (dew point, wind chill) stays in the enlargement.
      {
        kind: "value",
        options: { index: 1, pick: "temperature" },
        icon: { glyph: "device_thermostat" },
      },
      { kind: "value", options: { index: 2, pick: "humidity" } },
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
      { kind: "level", source: "position", icon: { glyph: "blinds" } },
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
      {
        kind: "value",
        source: "open",
        icon: { glyph: "window" },
        rules: [
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
        ],
      },
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
      {
        kind: "value",
        source: "motion",
        icon: { glyph: "sensors" },
        rules: [
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
        ],
      },
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
      { kind: "level", source: "temperature" },
      { kind: "enum", source: "mode" },
      { kind: "level", source: "fan" },
      { kind: "value", source: "power", icon: { glyph: "ac_unit" } },
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
    slots: [{ kind: "value", icon: { glyph: "speed" } }, ago, offline],
  },
  Custom: {
    id: "Custom",
    name: "Custom",
    builtin: true,
    type: "Custom",
    size: { w: 1, h: 1 },
    features: DEVICE_FEATURES.Custom,
    slots: [
      { kind: "value", source: "value", icon: { glyph: "widgets" } },
      { kind: "level", source: "level" },
      { kind: "button", source: "power" },
      offline,
    ],
  },
};
