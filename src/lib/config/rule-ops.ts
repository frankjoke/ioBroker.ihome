import type { Rule, Slot } from "$lib/types/display";
import { isHexColor } from "$lib/config/appearance";
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

/**
 * The standard badge colours, as theme tokens so they follow the light/dark
 * palette instead of freezing a hex. `options.color` takes one of these names
 * or a hex (the pane's custom picker); anything else is ignored.
 */
export const BADGE_COLORS: Record<string, string> = {
  primary: "var(--primary-color)",
  secondary: "var(--secondary-color)",
  text: "var(--text-color)",
  muted: "var(--text-muted)",
  success: "var(--success-color)",
  warning: "var(--warning-color)",
  danger: "var(--danger-color)",
};

function badgeColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value in BADGE_COLORS) return BADGE_COLORS[value];
  return isHexColor(value) ? value : undefined;
}

/** Where a badge sits: one of nine anchors on the tile's edge. */
export type BadgeX = "left" | "center" | "right";
export type BadgeY = "top" | "middle" | "bottom";

export interface BadgeAnchor {
  x: BadgeX;
  y: BadgeY;
}

export function anchorKey(anchor: BadgeAnchor): string {
  return `${anchor.y}-${anchor.x}`;
}

/** Every anchor, for rendering. */
export const BADGE_ANCHORS: BadgeAnchor[] = [
  { x: "left", y: "top" },
  { x: "center", y: "top" },
  { x: "right", y: "top" },
  { x: "left", y: "middle" },
  { x: "center", y: "middle" },
  { x: "right", y: "middle" },
  { x: "left", y: "bottom" },
  { x: "center", y: "bottom" },
  { x: "right", y: "bottom" },
];

/**
 * The corners unpositioned badges fill, in order: top-right first, then the
 * right column down, then the left. A corner claimed by an explicit position is
 * skipped, so empty badges fill the empty slots instead of piling up.
 */
const AUTO_CORNERS: BadgeAnchor[] = [
  { x: "right", y: "top" },
  { x: "right", y: "bottom" },
  { x: "left", y: "top" },
  { x: "left", y: "bottom" },
];

const XS: BadgeX[] = ["left", "center", "right"];
const YS: BadgeY[] = ["top", "middle", "bottom"];

function badgeX(value: unknown): BadgeX | undefined {
  return XS.includes(value as BadgeX) ? (value as BadgeX) : undefined;
}

function badgeY(value: unknown): BadgeY | undefined {
  return YS.includes(value as BadgeY) ? (value as BadgeY) : undefined;
}

/**
 * Where each badge slot's badges sit. A slot with both `options.x` and
 * `options.y` keeps that anchor; every other slot takes the next free corner
 * (wrapping once all are used). A half-set or junk value keeps the axis it
 * names and takes the other from the fill.
 */
export function badgePositions(slots: Slot[]): BadgeAnchor[] {
  const parts = slots.map((slot) => ({
    x: badgeX(slot.options?.x),
    y: badgeY(slot.options?.y),
  }));
  const claimed = new Set(
    parts.filter((p) => p.x && p.y).map((p) => `${p.y}-${p.x}`),
  );
  const free = AUTO_CORNERS.filter((c) => !claimed.has(anchorKey(c)));
  const order = free.length ? free : AUTO_CORNERS;
  let next = 0;
  return slots.map((_, i) => {
    const p = parts[i];
    if (p.x && p.y) return { x: p.x, y: p.y };
    const fill = order[next++ % order.length];
    return { x: p.x ?? fill.x, y: p.y ?? fill.y };
  });
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
  /** An explicit colour (rule colour, or the slot's named/hex colour) — wins
   *  over the tone class. */
  color?: string;
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
export function truthy(v: unknown): boolean {
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

/**
 * Fold the matching rules in order; the last match wins per key. A rule marked
 * `only` is a visibility gate instead of a style: while at least one gate is
 * present and none matches, the slot hides — applied after the fold, so a later
 * `hidden: false` cannot reopen it. A gate with a broken expression fails
 * closed; the pane's live result dot is what catches the typo.
 */
export function resolveStyle(rules: Rule[], scope: Scope): ResolvedStyle {
  const style: ResolvedStyle = {};
  let gates = 0;
  let open = 0;
  for (const rule of rules ?? []) {
    const hit = evalRule(rule, scope);
    if (rule.only) {
      gates++;
      if (hit) open++;
    }
    if (!hit) continue;
    if (rule.icon !== undefined) style.icon = rule.icon;
    if (rule.color !== undefined) style.color = rule.color;
    if (rule.glow !== undefined) style.glow = rule.glow;
    if (rule.background !== undefined) style.background = rule.background;
    if (rule.hidden !== undefined) style.hidden = rule.hidden;
    if (rule.disabled !== undefined) style.disabled = rule.disabled;
    if (rule.tone !== undefined) style.tone = rule.tone;
  }
  if (gates > 0 && open === 0) style.hidden = true;
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
export interface BadgeControl {
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
  raw?: (source: string) => BadgeControl | undefined,
): ResolvedBadge | undefined {
  const pick =
    typeof slot.options?.pick === "string" ? slot.options.pick : undefined;
  const control =
    badgeControl(device, slot.source, pick) ??
    (slot.source ? raw?.(slot.source) : undefined);
  if (!control) return undefined;
  // Slot rules first, the control's own defaults last (spec §4.1.1).
  const style = resolveStyle(
    [...(slot.rules ?? []), ...(control.rules ?? [])],
    scope,
  );
  // A hidden slot or control produces no badge — the same fold the tile body
  // uses for its slots (a rule may hide a badge by value, not just by state).
  if (style.hidden === true) return undefined;
  // Colour precedence: a matched rule's colour, then a matched rule's tone,
  // then the slot's static colour, then the tone default (`info`).
  const explicitTone = TONES.includes(style.tone as BadgeTone);
  return {
    source: String(slot.source),
    icon: style.icon ?? "info",
    tone: toneOf(style),
    label: formatValue(control.liveValue, slot.unit ?? control.unit),
    color:
      style.color ??
      (explicitTone ? undefined : badgeColor(slot.options?.color)),
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
  raw?: (source: string) => BadgeControl | undefined,
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
    // A badge hidden by its own rules produces nothing — including the derived
    // ago/offline badges, which resolve no control and so never reach
    // `controlBadge`'s own guard.
    if (resolveStyle(slot.rules ?? [], scope).hidden === true) continue;
    // The derived ago/offline badges have no rules; their slot colour outranks
    // the tone they are born with (a control badge resolves colour itself).
    const color = badgeColor(slot.options?.color);
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
      if (badge && color) badge.color = color;
    } else if (slot.source === "offline") {
      badge = offline ? { ...offline, ...(color ? { color } : {}) } : undefined;
    } else if (slot.source || typeof slot.options?.pick === "string") {
      // A badge reads a control either by name or by readout hint — or, failing
      // both, a raw state id through the caller's resolver (A21).
      badge = controlBadge(slot, device, scope, raw);
    }
    if (badge) out.push(badge);
  }
  return out;
}
