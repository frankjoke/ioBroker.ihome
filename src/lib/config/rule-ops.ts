import type { Rule, Slot } from "$lib/types/display";
import {
  buildScope,
  sanitizeLabel,
  evaluateVirtual,
  type LocalControl,
  type PoolEntry,
  type Scope,
} from "$lib/config/virtual-ops";
import { formatAge, formatValue } from "$lib/config/format";

export type BadgeTone = "info" | "ok" | "warn" | "danger";

const TONES: BadgeTone[] = ["info", "ok", "warn", "danger"];

/** An `ago` badge turns warn once a state is older than this. */
export const AGO_WARN_MS = 86_400_000;

/** Whatever the matching rules set. Absent keys mean "not specified". */
export interface ResolvedStyle {
  icon?: string;
  color?: string;
  glow?: boolean;
  background?: string;
  hidden?: boolean;
  tone?: string;
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
    liveValue?: unknown;
    unit?: string;
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
  const locals: Record<string, unknown> = { ...base.locals };
  const taken = new Set(Object.keys(locals));
  for (const c of controls ?? []) {
    if (c.kind === "virtual") continue;
    const name = sanitizeLabel(c.feature, new Set<string>());
    if (!name || taken.has(name)) continue;
    locals[name] = c.liveValue;
    taken.add(name);
  }
  return { locals, helpers: base.helpers };
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
function controlBadge(
  slot: Slot,
  device: BadgeDevice,
  scope: Scope,
): ResolvedBadge | undefined {
  const control = (device.controls ?? []).find(
    (c) => c.feature === slot.source || c.id === slot.source,
  );
  if (!control) return undefined;
  const style = resolveStyle(slot.rules ?? [], scope);
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
  ts: number | undefined,
  now: number,
  pool: PoolEntry[] = [],
): ResolvedBadge[] {
  const scope = ruleScope((device.controls ?? []) as LocalControl[], pool);
  const out: ResolvedBadge[] = [];
  for (const slot of slots ?? []) {
    if (slot.kind !== "badge") continue;
    let badge: ResolvedBadge | undefined;
    if (slot.source === "ago") badge = agoBadge(ts, now);
    else if (slot.source === "offline") badge = offlineBadge(device);
    else if (slot.source) badge = controlBadge(slot, device, scope);
    if (badge) out.push(badge);
  }
  return out;
}
