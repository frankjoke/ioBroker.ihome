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
    help: `A simple on/off device: a switch, plug or relay.

**Configure:** add a device of type Switch under Devices and map its **power** control to the state that switches it. Extra readings, such as consumption, appear as a badge.

The tile glows green while the device is on and the badge tells you when it was last seen.`,
    builtin: true,
    type: "Switch",
    size: { w: 2, h: 2 },
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
    help: `A tile for a momentary push button: a doorbell, a scene button or a physical remote.

**Configure:** map the **press** control to the state that triggers the action. Pressing the tile writes that state.`,
    builtin: true,
    type: "Button",
    size: { w: 2, h: 2 },
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
    help: `A light tile with power, brightness and colour.

**Configure:** map **power**, **brightness** and **colour** to your light's states. Only map the controls your device really has.

The tile glows amber while the light is on; the slider and colour picker write back to the device.`,
    builtin: true,
    type: "Light",
    size: { w: 2, h: 2 },
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
    help: `A thermostat tile with the measured temperature, a setpoint and a mode.

**Configure:** map **actual** and **setpoint** to the measured and target temperature states, and **mode** to the operating mode if the device has one.

The slider writes the setpoint; the dropdown writes the mode.`,
    builtin: true,
    type: "Thermostat",
    size: { w: 4, h: 2 },
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
    help: `A read-only tile for a temperature sensor: temperature first, humidity second, both chosen by their role.

**Configure:** add the sensor under Devices and map its controls. Dew point, wind chill and other readings stay available when you enlarge the tile.

A low battery appears as a warning badge.`,
    builtin: true,
    type: "Thermometer",
    size: { w: 2, h: 2 },
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
    help: `A roller blind or shutter tile.

**Configure:** map **position** to the percentage state (0 and 100 mean open or closed, depending on the actuator) and **stop** to its stop command.

Moving the slider writes the position; the stop button halts movement.`,
    builtin: true,
    type: "Blind",
    size: { w: 4, h: 2 },
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
    help: `A window or door contact tile: open or closed.

**Configure:** map **open** to the contact state. An open window shows in amber, a closed one is dimmed.

The badge tells you when the state last changed.`,
    builtin: true,
    type: "Window",
    size: { w: 2, h: 2 },
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
    help: `A motion detector tile.

**Configure:** map **motion** to the sensor state. The tile shows when motion is detected and how long ago the last motion was — not when the battery last reported.`,
    builtin: true,
    type: "Motion",
    size: { w: 2, h: 2 },
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
    help: `An air-conditioner tile: target temperature, mode, fan speed and power.

**Configure:** map each control your unit supports; leave the others unmapped. The tile is 2×2, and the sliders and dropdown write the matching states.`,
    builtin: true,
    type: "AC",
    size: { w: 4, h: 4 },
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
  Meter: {
    id: "Meter",
    name: "Meter",
    help: `A power meter tile: current consumption plus an energy total.

**Configure:** map **power** and **energy** to the meter's states. The large reading is current power; the badge shows the energy counter.`,
    builtin: true,
    type: "Meter",
    size: { w: 4, h: 2 },
    features: DEVICE_FEATURES.Meter,
    slots: [
      { kind: "value", source: "power", icon: { glyph: "bolt" } },
      { kind: "badge", options: { pick: "energy" } },
      ago,
      offline,
    ],
  },
  Value: {
    id: "Value",
    name: "Value",
    help: `A generic tile for a single reading: pressure, speed, a text status.

**Configure:** map one control and set its unit under Devices. For timestamps, set the unit to a date format such as "ago" so the tile keeps the time current.`,
    builtin: true,
    type: "Value",
    size: { w: 2, h: 2 },
    features: DEVICE_FEATURES.Value,
    slots: [{ kind: "value", icon: { glyph: "speed" } }, ago, offline],
  },
  Custom: {
    id: "Custom",
    name: "Custom",
    help: `A starter layout with one value, one slider and one button.

Use it when no preset fits: add the device under Devices, then open the layout editor and keep, change or delete each slot. Every control you map is available to the slots.`,
    builtin: true,
    type: "Custom",
    size: { w: 2, h: 2 },
    features: DEVICE_FEATURES.Custom,
    slots: [
      { kind: "value", source: "value", icon: { glyph: "widgets" } },
      { kind: "level", source: "level" },
      { kind: "button", source: "power" },
      offline,
    ],
  },
};
