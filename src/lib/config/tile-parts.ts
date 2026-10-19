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
  // actually render are the ones with a reading (an icon keeps its fallback, a
  // frame needs none) that no rule hides.
  const rows: SlotRow[] = pickSlotControls<SlotControl>(slots, shownControls, {
    active,
    raw,
  })
    .filter(
      (r) =>
        (r.slot.kind === "icon" || r.slot.kind === "frame" || r.control) &&
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

/** The tile's face (A52): the first value slot, else the first non-icon slot —
 *  a legacy Button tile's face is its button, not its old icon slot. */
export function headlineSlot(slots: Slot[]): Slot | undefined {
  return (
    slots.find((s) => s.kind === "value") ??
    slots.find((s) => s.kind !== "icon")
  );
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
