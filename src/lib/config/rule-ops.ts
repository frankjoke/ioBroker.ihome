import type { Rule, Slot } from "$lib/types/display";
import {
  buildScope,
  newLocalTaken,
  sanitizeLabel,
  evaluateVirtual,
  type LocalControl,
  type PoolEntry,
  type Scope,
} from "$lib/config/virtual-ops";
import { formatAge, formatValue } from "$lib/config/format";
import { pickControl } from "$lib/config/template-ops";

export type BadgeTone = "info" | "ok" | "warn" | "danger";

const TONES: BadgeTone[] = ["info", "ok", "warn", "danger"];

/** Which corner of a tile a badge lives in. */
export type BadgeCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: BadgeCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/**
 * Where a badge kind belongs by default, because position carries meaning:
 * how long ago it changed (bottom-left), something wrong (top-right), a reading
 * (top-left). A slot may override it with `options.position`.
 */
const BADGE_CORNERS: Record<string, BadgeCorner> = {
  ago: "bottom-left",
  battery: "top-right",
  offline: "top-right",
  alarm: "top-right",
  error: "top-right",
};

export function badgePosition(slot: Slot): BadgeCorner {
  const explicit = slot.options?.position;
  if (
    typeof explicit === "string" &&
    CORNERS.includes(explicit as BadgeCorner)
  ) {
    return explicit as BadgeCorner;
  }
  return BADGE_CORNERS[String(slot.source ?? "")] ?? "top-left";
}

/** An `ago` badge turns warn once a state is older than this. */
export const AGO_WARN_MS = 86_400_000;

/** Whatever the matching rules set. Absent keys mean "not specified". */
export interface ResolvedStyle {
  icon?: string;
  color?: string;
  glow?: boolean;
  background?: string;
  hidden?: boolean;
  disabled?: boolean;
  tone?: string;
}

/**
 * Where an `ago` badge reads its time from. The Tile builds it over the live
 * state map; a badge that names no control gets the device-wide newest `ts`.
 */
export interface TimeSource {
  at(source: string | undefined, from: "ts" | "lc"): number | undefined;
}

export interface ResolvedBadge {
  source: string;
  icon: string;
  tone: BadgeTone;
  label: string;
  title?: string;
}

/** The device shape a badge needs — `EnrichedDevice` satisfies it structurally. */
export interface BadgeDevice {
  available?: boolean;
  controls?: {
    id?: string;
    feature?: string;
    available?: boolean;
    hidden?: boolean;
    liveValue?: unknown;
    unit?: string;
    label?: string;
    role?: string;
    rules?: Rule[];
  }[];
}

/**
 * Rule expressions see the device's controls under **feature** names
 * (`power`, `brightness`, …) — a preset must not depend on what a device's label
 * happens to say. Label names are kept too, so a formula already written
 * against a label keeps working, and the pool helpers (`get`, `values`, …) come
 * along as in the virtual-formula editor. One language, one skill.
 */
export function ruleScope(controls: LocalControl[], pool: PoolEntry[]): Scope {
  const base = buildScope(controls, pool);
  const taken = newLocalTaken();
  const locals: Record<string, unknown> = {};
  // Features (virtual readings included) are reserved first, so a preset rule
  // naming a feature can never be shadowed by another control's label.
  for (const c of controls ?? []) {
    locals[sanitizeLabel(c.feature, taken)] = c.liveValue;
    // Convenience alias: `dewPoint` as well as `dewpoint`, when it is a legal
    // identifier and nothing else claimed it.
    const raw = String(c.feature ?? "");
    if (
      /^[A-Za-z_$][\w$]*$/.test(raw) &&
      raw !== sanitizeLabel(raw, new Set())
    ) {
      if (!(raw in locals)) locals[raw] = c.liveValue;
    }
  }
  // Labels come second and take a suffix on collision, so a formula written
  // against a label keeps working without stealing a feature name.
  for (const c of controls ?? []) {
    locals[sanitizeLabel(c.label, taken)] = c.liveValue;
  }
  return { locals, helpers: { ...base.helpers, truthy } };
}

/** On/off values as ioBroker stores them: true, 1, "1", "true". */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/**
 * Does a rule apply? Exact `true` only — an expression that evaluates to
 * `undefined`, or one that throws, does not match. A tile must never fail to
 * render because a `when` had a typo.
 */
export function evalRule(rule: Rule, scope: Scope): boolean {
  if (!rule?.when) return false;
  const { value, error } = evaluateVirtual(rule.when, scope);
  return !error && value === true;
}

/** Fold the matching rules in order; the last match wins per key. */
export function resolveStyle(rules: Rule[], scope: Scope): ResolvedStyle {
  const style: ResolvedStyle = {};
  for (const rule of rules ?? []) {
    if (!evalRule(rule, scope)) continue;
    if (rule.icon !== undefined) style.icon = rule.icon;
    if (rule.color !== undefined) style.color = rule.color;
    if (rule.glow !== undefined) style.glow = rule.glow;
    if (rule.background !== undefined) style.background = rule.background;
    if (rule.hidden !== undefined) style.hidden = rule.hidden;
    if (rule.disabled !== undefined) style.disabled = rule.disabled;
    if (rule.tone !== undefined) style.tone = rule.tone;
  }
  return style;
}

/** How long ago the device last reported, as a badge. */
export function agoBadge(
  ts: number | undefined,
  now: number,
): ResolvedBadge | undefined {
  if (typeof ts !== "number" || !ts) return undefined;
  return {
    source: "ago",
    icon: "schedule",
    tone: now - ts > AGO_WARN_MS ? "warn" : "info",
    label: formatAge(ts, now),
    title: new Date(ts).toLocaleString(),
  };
}

/** A device with no reachable state object — the "is it dead" signal. */
export function offlineBadge(device: BadgeDevice): ResolvedBadge | undefined {
  const controls = device?.controls ?? [];
  if (!controls.length) return undefined;
  if (controls.every((c) => c.available !== false)) return undefined;
  return {
    source: "offline",
    icon: "cloud_off",
    tone: "danger",
    label: "offline",
  };
}

function toneOf(style: ResolvedStyle): BadgeTone {
  const tone = style.tone as BadgeTone;
  return TONES.includes(tone) ? tone : "info";
}

/** Resolve a badge slot against a device control; no source → no badge. */
interface BadgeControl {
  id?: string;
  feature?: string;
  available?: boolean;
  hidden?: boolean;
  liveValue?: unknown;
  unit?: string;
  rules?: Rule[];
}

/**
 * The control a badge reads: an explicit `source` (feature → id), or a readout
 * hint (`options.pick: "power"`) so a preset can badge a reading the device names
 * in its own way (`Brunnen.Leistung`).
 */
function badgeControl(
  device: BadgeDevice,
  source: string | undefined,
  pick: string | undefined,
): BadgeControl | undefined {
  const controls = ((device.controls ?? []) as BadgeControl[]).filter(
    (c) => !c.hidden,
  );
  if (pick) {
    const chosen = pickControl(controls, pick, new Set());
    if (chosen) return chosen;
  }
  return (
    controls.find((c) => c.feature === source) ??
    controls.find((c) => c.id === source)
  );
}

function controlBadge(
  slot: Slot,
  device: BadgeDevice,
  scope: Scope,
): ResolvedBadge | undefined {
  const pick =
    typeof slot.options?.pick === "string" ? slot.options.pick : undefined;
  const control = badgeControl(device, slot.source, pick);
  if (!control) return undefined;
  // Slot rules first, the control's own defaults last (spec §4.1.1).
  const style = resolveStyle(
    [...(slot.rules ?? []), ...(control.rules ?? [])],
    scope,
  );
  return {
    source: String(slot.source),
    icon: style.icon ?? "info",
    tone: toneOf(style),
    label: formatValue(control.liveValue, slot.unit ?? control.unit),
  };
}

/**
 * Badges for a tile, in slot order. `ago` and `offline` are derived from the
 * device itself, so a template gets them without declaring a control for them.
 * `pool` is the subscribed state pool (as tile rules use), so a badge rule can
 * read a raw state id with `get("<id>")` when the device watches it.
 */
export function resolveBadges(
  slots: Slot[],
  device: BadgeDevice,
  time: TimeSource | number | undefined,
  now: number,
  pool: PoolEntry[] = [],
): ResolvedBadge[] {
  // Accept a bare number too (the device-wide newest `ts`).
  const stamp = typeof time === "number" ? time : undefined;
  const clock: TimeSource =
    typeof time === "object" && time !== null ? time : { at: () => stamp };
  const scope = ruleScope((device.controls ?? []) as LocalControl[], pool);
  const offline = offlineBadge(device);
  const out: ResolvedBadge[] = [];
  for (const slot of slots ?? []) {
    if (slot.kind !== "badge") continue;
    let badge: ResolvedBadge | undefined;
    // An offline device says *that*, not a misleading "how long ago it was".
    if (slot.source === "ago") {
      // `options.of` names the control to watch — the whole point of an `ago`
      // badge on a motion sensor is the last *motion*, not the last battery
      // report. `options.from` picks `ts` (still reporting) or `lc` (last value
      // change); the default is the device-wide newest `ts`.
      const of =
        typeof slot.options?.of === "string" ? slot.options.of : undefined;
      const from = slot.options?.from === "lc" ? "lc" : "ts";
      badge = offline ? undefined : agoBadge(clock.at(of, from), now);
    } else if (slot.source === "offline") {
      badge = offline;
    } else if (slot.source || typeof slot.options?.pick === "string") {
      // A badge reads a control either by name or by readout hint.
      badge = controlBadge(slot, device, scope);
    }
    if (badge) out.push(badge);
  }
  return out;
}
