import type { EnrichedDevice, SlotControl } from "$lib/types/device";
import type { Slot, SlotKind, Template, TileConfig } from "$lib/types/display";
import type { Rule, StateLook } from "$lib/types/display";
import {
  pickSlotControls,
  resolveTemplate,
  slotVisible,
} from "$lib/config/template-ops";
import { slotWhere } from "$lib/config/tile-ops";
import { BLANK_DEVICE_ID } from "$lib/config/blank-tile";
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
  /** The slot's glyph is the template's own, not a choice (A67). */
  iconIsTemplate?: boolean;
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
  /** The detail page's rows (A34): every kind, whatever its home. */
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
  const chain = resolveTemplate(device, templates);
  const slots =
    device.id === BLANK_DEVICE_ID
      ? (tile?.slots ?? [])
      : (tile?.slots ?? chain.slots);

  /** Does this slot carry the glyph the template gives it (A67)? Such a glyph is
   *  a type default, not a choice, so the device's found icon may stand in for
   *  it. Compared by position and kind against the chain's own slots. */
  const templateGlyph = (slot: Slot): boolean => {
    const at = slots.indexOf(slot);
    const via = at < 0 ? undefined : chain.slots[at];
    return (
      !!slot.icon?.glyph &&
      !!via &&
      via.kind === slot.kind &&
      via.icon?.glyph === slot.icon?.glyph
    );
  };

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
        (r.slot.kind === "frame" || r.slot.kind === "html" || r.control) &&
        styleOf(r.slot, r.control).hidden !== true,
    )
    .map((r) => ({
      slot: r.slot,
      control: r.control,
      style: styleOf(r.slot, r.control),
      iconIsTemplate: templateGlyph(r.slot),
    }));

  // The body is every row that lives on the tile (A59: nothing draws as a
  // layer of its own any more — the chart comes from the rows).
  const body = rows.filter((r) => slotWhere(r.slot) !== "modal");
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
    modal,
    badgeSlots,
    modalBadges,
    hasModal:
      modal.length > 0 ||
      (raw ? modalBadges.length > 0 : modalBadgeSlots.length > 0),
  };
}

/** The tile's face: the first slot that actually renders a reading (value,
 *  switch, level, …). A badge or frame never becomes the face while a real slot
 *  exists. This is the slot the tile's own icon (look glyph) dresses, so a
 *  switch-first tile keeps its main icon on the first slot instead of moving it
 *  to a later value slot. Falls back to the first slot when nothing else exists. */
const FACE_KINDS = new Set<SlotKind>([
  "value",
  "switch",
  "level",
  "color",
  "enum",
  "button",
]);

export function headlineSlot(slots: Slot[]): Slot | undefined {
  return (
    slots.find((s) => FACE_KINDS.has(s.kind)) ??
    slots.find(
      (s) => s.kind !== "badge" && s.kind !== "frame" && s.kind !== "html",
    ) ??
    slots[0]
  );
}

/** The look of the tile's current state (A71). A tile with no active condition
 *  never becomes active, so its one state is the inactive one — the pane edits
 *  those values as the tile's default look. */
export function stateLook(
  tile: TileConfig | undefined,
  active: boolean,
): StateLook {
  if (!tile) return {};
  if (!tile.active) return tile.look?.inactive ?? {};
  return tile.look?.[active ? "active" : "inactive"] ?? {};
}

/** The icon a resolved row shows in `home` (A51/A54): enabled, glyphed, allowed
 *  there — the last matching rule's glyph beats the descriptor's, and a glyph the
 *  template gave gives way to the device's own icon (A67). */
export function rowIcon(
  row: SlotRow,
  home: "tile" | "modal",
  deviceIcon?: string,
): { glyph: string; color?: string; disabled?: boolean } | undefined {
  const icon = row.slot.icon;
  if (!icon || icon.enabled === false) return undefined;
  const where = icon.where ?? "both";
  if (where !== "both" && where !== home) return undefined;
  const glyph =
    row.style.icon ??
    (row.iconIsTemplate ? (deviceIcon ?? icon.glyph) : icon.glyph);
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
