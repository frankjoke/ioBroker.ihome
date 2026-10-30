import type { Control, ControlMeta, Widget } from "$lib/types/device";
import { localizeName } from "$lib/config/format";

/**
 * The one place a control's correction meets the broker object (spec §3):
 * object `common` → legacy `control.common` → the control's explicit fields.
 * The control wins, so a badly decorated state can be repaired in the device
 * document without touching the broker.
 */

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value === "" ? "" : value;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return value === undefined ||
    value === null ||
    value === "" ||
    !Number.isFinite(n)
    ? undefined
    : n;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** ioBroker `states` in either shape → `{ value: label }`; junk → undefined. */
export function normalizeStates(
  states: unknown,
): Record<string, string> | undefined {
  if (Array.isArray(states)) {
    if (!states.length) return undefined;
    return Object.fromEntries(
      states.map((label, i) => [String(i), localizeName(label)]),
    );
  }
  if (!states || typeof states !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [value, label] of Object.entries(
    states as Record<string, unknown>,
  )) {
    const text = localizeName(label);
    if (text) out[value] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The effective metadata of a control, after the correction wins. */
export function effectiveCommon(
  control: Control,
  object?: { common?: Record<string, any> },
): ControlMeta {
  const base = object?.common ?? {};
  const legacy = control.common ?? {};
  const own: Record<string, unknown> = {};
  for (const key of [
    "role",
    "type",
    "states",
    "unit",
    "min",
    "max",
    "step",
    "read",
    "write",
  ] as const) {
    if (control[key] !== undefined) own[key] = control[key];
  }

  const merged = { ...base, ...legacy, ...own } as Record<string, any>;
  const meta: ControlMeta = {
    name: localizeName(merged.name) || undefined,
    role: text(merged.role),
    type: text(merged.type),
    states: normalizeStates(merged.states),
    unit: control.hideUnit === true ? "" : text(merged.unit),
    min: num(merged.min),
    max: num(merged.max),
    step: num(merged.step),
    read: flag(merged.read),
    write: flag(merged.write),
  };
  return meta;
}

/**
 * The widget a shape suggests (spec §5): states → enum, then the roles, then
 * the caller's fallback (the device type/feature map), then the boolean guess —
 * a writable boolean with no better answer is a switch, a read-only one a value.
 */
export function widgetForMeta(meta: ControlMeta, fallback?: Widget): Widget {
  if (meta.states) return "enum";
  const role = String(meta.role ?? "");
  const type = String(meta.type ?? "");
  if (/switch/i.test(role)) return "switch";
  if (/color/i.test(role) || type === "color") return "color";
  if (/button|press/i.test(role)) return "button";
  if (
    type === "number" &&
    (meta.min !== undefined ||
      meta.max !== undefined ||
      meta.step !== undefined ||
      /level|dimmer|brightness|setpoint|position|volume/.test(role))
  ) {
    return "level";
  }
  if (fallback) return fallback;
  if (type === "boolean" && meta.write === true) return "switch";
  return "value";
}
