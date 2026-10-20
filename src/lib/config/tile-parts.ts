import type { EnrichedDevice, SlotControl } from "$lib/types/device";
import type { Slot, Template, TileConfig } from "$lib/types/display";
import type { Rule } from "$lib/types/display";
import {
  pickSlotControls,
  resolveTemplate,
  slotVisible,
} from "$lib/config/template-ops";
import { slotWhere } from "$lib/config/tile-ops";
import {
  resolveBadges,
  resolveStyle,
  ruleScope,
  type ResolvedBadge,
  type ResolvedStyle,
  type TimeSource,
} from "$lib/config/rule-ops";
import type { PoolEntry } from "$lib/config/virtual-ops";

/** One slot of a tile, resolved: what it shows and how it looks right now. */
export interface SlotRow {
  slot: Slot;
  control?: SlotControl;
  style: ResolvedStyle;
}

export interface TileParts {
  /** The slots the resolution ran on (A18): the tile's own once materialised,
   *  the chain's until then — the very objects every row carries, so a
   *  headline pick (A52) is a reference, not a second resolution. */
  slots: Slot[];
  /** Every resolved, visible row, in slot order — each exactly once, whatever
   *  its home (A59: the tile's chart reads this, so a modal-only value charts). */
  rows: SlotRow[];
  /** The tile's visible body, in slot order. */
  body: SlotRow[];
  /** The chart layer (A22): `options.background` slots, drawn over the body. */
  background: SlotRow[];
  /** The detail page's rows (A34) — every kind, the chart layer as a plain row. */
  modal: SlotRow[];
  /** The corner badges (A34), in slot order. */
  badgeSlots: Slot[];
  /** The detail page's badge chips (A34), resolved. */
  modalBadges: ResolvedBadge[];
  /** Anything at all in the detail page: rows or badge chips. */
  hasModal: boolean;
}

/**
 * A tile's resolved parts, in one place (A46/A47): the display's `Tile` renders
 * them and the sheet asks the same resolution whether a tile has a detail page
 * at all. Moving the chain out of the component is the point — the sheet's
 * "does anything live in the modal?" question must not be a second, approximate
 * answer (the spike read the slots' `where` and ignored rules).
 *
 * `opts` carries what only the live component has: the badge clock and state
 * pool, and the raw-state pseudo-control (A21). The sheet passes none of them;
 * then `hasModal` counts the badge slots that live in the modal rather than
 * resolving chips, because it is asking about content, not wording.
 */
export function tileParts(
  device: EnrichedDevice,
  tile: TileConfig | undefined,
  templates: Template[],
  opts?: {
    active?: boolean;
    raw?: (source: string) => SlotControl | undefined;
    pool?: PoolEntry[];
    time?: TimeSource | number;
    now?: number;
  },
): TileParts {
  const active = opts?.active === true;
  const raw = opts?.raw;
  const shownControls = (device.controls ?? []).filter((c) => !c.hidden);
  const pool = opts?.pool ?? [];
  // The tile's own slots once it was materialised; the chain's until then (A18).
  const slots = tile?.slots ?? resolveTemplate(device, templates).slots;

  // Rule locals are the device's controls plus the pool helpers, and the tile's
  // own `active` flag wins the name over a control alias of the same name (A30).
  const baseScope = ruleScope(device.controls ?? [], pool);
  const scope = { ...baseScope, locals: { ...baseScope.locals, active } };

  /** Slot rules first, the control's own defaults last — the last match wins. */
  const styleOf = (
    slot: Slot,
    control?: SlotControl & { rules?: Rule[] },
  ): ResolvedStyle =>
    resolveStyle([...(slot.rules ?? []), ...(control?.rules ?? [])], scope);

  // A source or hint that matches nothing goes dormant (A20); the slots that
  // actually render are the ones with a reading (a frame needs none) that no
  // rule hides.
  const rows: SlotRow[] = pickSlotControls<SlotControl>(slots, shownControls, {
    active,
    raw,
  })
    .filter(
      (r) =>
        (r.slot.kind === "frame" || r.control) &&
        styleOf(r.slot, r.control).hidden !== true,
    )
    .map((r) => ({
      slot: r.slot,
      control: r.control,
      style: styleOf(r.slot, r.control),
    }));

  const background = rows.filter(
    (r) => r.slot.options?.background === true && slotWhere(r.slot) !== "modal",
  );
  const body = rows.filter(
    (r) => r.slot.options?.background !== true && slotWhere(r.slot) !== "modal",
  );
  const modal = rows.filter((r) => slotWhere(r.slot) !== "tile");

  const badgeSlots = slots.filter(
    (s) =>
      s.kind === "badge" && slotVisible(s, active) && slotWhere(s) !== "modal",
  );
  // Badges leave the tile for the modal's chip strip (A34).
  const modalBadgeSlots = slots.filter(
    (s) =>
      s.kind === "badge" && slotVisible(s, active) && slotWhere(s) !== "tile",
  );
  const modalBadges = raw
    ? modalBadgeSlots.flatMap((s) =>
        resolveBadges(
          [s],
          device,
          opts?.time,
          opts?.now ?? Date.now(),
          pool,
          raw,
        ),
      )
    : [];

  return {
    slots,
    rows,
    body,
    background,
    modal,
    badgeSlots,
    modalBadges,
    hasModal:
      modal.length > 0 ||
      (raw ? modalBadges.length > 0 : modalBadgeSlots.length > 0),
  };
}

/** The tile's face (A52): the first value slot, else the first slot — a legacy
 *  Button tile's face is its button. */
export function headlineSlot(slots: Slot[]): Slot | undefined {
  return slots.find((s) => s.kind === "value") ?? slots[0];
}

/** The icon a resolved row shows in `home` (A51/A54): enabled, glyphed, allowed
 *  there — the last matching rule's glyph beats the descriptor's. */
export function rowIcon(
  row: SlotRow,
  home: "tile" | "modal",
): { glyph: string; color?: string; disabled?: boolean } | undefined {
  const icon = row.slot.icon;
  if (!icon || icon.enabled === false) return undefined;
  const where = icon.where ?? "both";
  if (where !== "both" && where !== home) return undefined;
  const glyph = row.style.icon ?? icon.glyph;
  return glyph
    ? { glyph, color: row.style.color, disabled: row.style.disabled }
    : undefined;
}

// ------------------------------------------------------------------ charts

/** The series colours, in assignment order (A61): theme tokens, so the chart
 *  follows the theme like everything else. */
export const CHART_PALETTE = [
  "var(--primary-color)",
  "var(--success-color)",
  "var(--warning-color)",
  "var(--danger-color)",
  "var(--secondary-color)",
];

/** One value's charted line (A59/A61): what to draw, and in which colour. */
export interface ChartSeries {
  slot: Slot;
  control: SlotControl;
  color: string;
}

/** Can this control chart at all (A63): history configured *and* a state. */
export function hasHistory(control?: SlotControl): boolean {
  return !!control?.stateId && !!control.history;
}

/** Is the slot's chart defined and not switched off? */
function sparkOn(slot: Slot): boolean {
  return !!slot.spark && slot.spark.enabled !== false;
}

/** Does the chart draw in `home`? Its own `where` alone decides (A60). */
function sparkIn(slot: Slot, home: "tile" | "modal"): boolean {
  const where = slot.spark?.where ?? "both";
  return where === "both" || where === home;
}

/**
 * A slot's colour (A61): its own, else the palette colour of its place among
 * the tile's chart-enabled values — every row with an enabled spark whose
 * control has history, whatever its home — so the colour holds between the
 * tile and the detail row.
 */
function seriesColor(rows: SlotRow[], slot: Slot): string {
  const own = slot.spark?.color;
  if (own) return own;
  const charting = rows.filter((r) => sparkOn(r.slot) && hasHistory(r.control));
  const at = charting.findIndex((r) => r.slot === slot);
  return CHART_PALETTE[Math.max(0, at) % CHART_PALETTE.length];
}

/** The tile's chart (A61): every value that charts on the tile and can, in slot
 *  order — the row itself need not render there (A60). */
export function tileSeries(rows: SlotRow[]): ChartSeries[] {
  return rows
    .filter((r) => sparkIn(r.slot, "tile") && sparkOn(r.slot) && r.control)
    .filter((r) => hasHistory(r.control))
    .map((r) => ({
      slot: r.slot,
      control: r.control as SlotControl,
      color: seriesColor(rows, r.slot),
    }));
}

/** The chart one row draws in `home` (A62), or none. */
export function rowSpark(
  rows: SlotRow[],
  row: SlotRow,
  home: "tile" | "modal",
): ChartSeries | undefined {
  if (!row.control || !hasHistory(row.control)) return undefined;
  if (!sparkOn(row.slot) || !sparkIn(row.slot, home)) return undefined;
  return {
    slot: row.slot,
    control: row.control,
    color: seriesColor(rows, row.slot),
  };
}
