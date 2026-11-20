import type { EnrichedDevice, SlotControl } from "$lib/types/device";
import type {
  Slot,
  SlotKind,
  Template,
  TileConfig,
  TileChartConfig,
} from "$lib/types/display";
import type { Rule, StateLook } from "$lib/types/display";
import {
  pickSlotControls,
  resolveControl,
  slotVisible,
} from "$lib/config/template-ops";
import { inDetail, slotTileMode } from "$lib/config/tile-ops";
import {
  resolveBadges,
  resolveStyle,
  ruleScope,
  type ResolvedBadge,
  type ResolvedStyle,
  type TimeSource,
} from "$lib/config/rule-ops";
import {
  resolveSlotSource,
  type ResolvedSource,
  type SourceLook,
} from "$lib/config/slot-source";
import type {
  LocalControl,
  PoolEntry,
  ScopeExtras,
} from "$lib/config/virtual-ops";
import type { GlobalVariable } from "$lib/config/variables";
import { sourceRuleName } from "$lib/config/source-overrides";
import type { HistorySpec } from "$lib/types/device";
import type { SourceOverride } from "$lib/types/overrides";
import { offTwin, onTwin } from "$lib/config/icon-library";

/** One slot of a tile, resolved: what it shows and how it looks right now. */
export interface SlotRow {
  slot: Slot;
  control?: SlotControl;
  style: ResolvedStyle;
  /** The slot's glyph is the template's own, not a choice (A67). */
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

/** What a tile's rules can name: one local per bound source, or per watch
 *  override — the name the rule writes and the live value it reads. */
export interface TileSourceControl extends LocalControl {
  stateId?: string;
  /** The override the source binds, when it resolves through one. */
  overrideId?: string;
  /** The override's chart feed (spec §4): this entry's rows still chart. */
  history?: HistorySpec;
  /** The control's own default rules, as the slot style folds them. */
  rules?: Rule[];
}

/** What `tileSourceControls` reads beyond the slots themselves. */
export interface SourceControlOpts {
  /** The tile's own control bag: resolved `slot:N` pseudo keys point here. */
  device?: { controls?: TileControlLike[] };
  states?: Map<string, any>;
  objects?: Map<string, any>;
  variables?: GlobalVariable[];
  /** The overrides a raw-state source can bind to. */
  overrides?: SourceOverride[];
  derived?: SourceLook["derived"];
  /** Overrides a rule names although no slot binds them (spec §3.3). */
  watchOverrides?: string[];
}

/** The control-bag fields a rule local reads. */
export type TileControlLike = {
  kind?: "state" | "virtual";
  feature?: string;
  label?: string;
  liveValue?: unknown;
  stateId?: string;
  history?: HistorySpec;
  rules?: Rule[];
};

/** A control of the tile's own bag as a rule local. */
function bagControl(control: TileControlLike): TileSourceControl {
  return {
    kind: control.kind,
    feature: control.feature,
    label: control.label ?? control.feature,
    liveValue: control.liveValue,
    stateId: control.stateId,
    history: control.history,
    rules: control.rules,
  };
}

/**
 * The tile's rule scope, in slot order (spec §3.3): one local per bound source,
 * named by the override's **name** (its label stays the display label), then
 * the watch overrides. `ruleScope` suffixes a repeated name, in this order, so
 * `power2` keeps meaning what it meant before the migration. A frame/html or
 * source-less slot binds no reading and contributes nothing.
 */
export function tileSourceControls(
  slots: Slot[],
  opts: SourceControlOpts = {},
): TileSourceControl[] {
  const look: SourceLook = {
    states: opts.states ?? new Map(),
    objects: opts.objects ?? new Map(),
    variables: opts.variables,
    overrides: opts.overrides,
    derived: opts.derived,
  };
  /** A resolved source as a local; the override's name wins over its label,
   *  and a raw state is named by its id leaf, not the broker's label. */
  const control = (
    resolved: ResolvedSource | undefined,
  ): TileSourceControl | undefined => {
    if (!resolved) return undefined;
    const override = resolved.overrideId
      ? opts.overrides?.find((o) => o.id === resolved.overrideId)
      : undefined;
    const name =
      sourceRuleName({
        overrideName: override?.name,
        controlFeature: resolved.control?.feature,
        stateId: resolved.stateId,
      }) ?? resolved.label;
    if (!name) return undefined;
    return {
      feature: name,
      label: resolved.label ?? name,
      liveValue: resolved.value,
      stateId: resolved.stateId,
      overrideId: resolved.overrideId,
      history: resolved.history,
      rules: resolved.control?.rules,
    };
  };
  const out: TileSourceControl[] = [];
  for (const slot of slots ?? []) {
    if (slot.kind === "frame" || slot.kind === "html" || !slot.source) continue;
    const source = slot.source;
    if (typeof source === "string") {
      // A v1 string source (or a resolved `slot:N`): the tile's own bag knows it.
      const found = resolveControl(opts.device?.controls ?? [], source);
      if (found) out.push(bagControl(found));
      continue;
    }
    const entry = control(resolveSlotSource(source, look));
    if (entry) out.push(entry);
  }
  for (const id of opts.watchOverrides ?? []) {
    const override = opts.overrides?.find((o) => o.id === id);
    if (!override) continue;
    const entry = control(
      resolveSlotSource(
        { kind: "state", stateId: override.stateId, override: id },
        look,
      ),
    );
    if (entry) out.push(entry);
  }
  return out;
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
  _templates: Template[],
  opts?: {
    active?: boolean;
    raw?: (source: string) => SlotControl | undefined;
    pool?: PoolEntry[];
    time?: TimeSource | number;
    now?: number;
    /** The override look a raw-state slot resolves through (spec §3.3). */
    overrides?: SourceOverride[];
    states?: Map<string, any>;
    objects?: Map<string, any>;
    variables?: GlobalVariable[];
    derived?: SourceLook["derived"];
    /** The tile's one rule list, built by the display from the tile's own
     *  slots (raw, so a device/derive badge keeps its name) plus the watch
     *  overrides. Absent → built from `slots`, for a caller holding a raw tile. */
    controls?: LocalControl[];
    /** Rule locals beyond the sources: the config's variables. */
    extras?: ScopeExtras;
  },
): TileParts {
  const active = opts?.active === true;
  const raw = opts?.raw;
  const shownControls = (device.controls ?? []).filter((c) => !c.hidden);
  const pool = opts?.pool ?? [];
  // The tile's own slots: the renderer's resolution always materialises them.
  const slots = tile?.slots ?? [];

  // Rule locals are the tile's bound sources — overrides and watch overrides
  // included — plus the pool helpers and the config's variables, and the
  // tile's own `active` flag wins the name over a source of the same name
  // (A30). The display hands in its one list so the rows, their badges and the
  // corner chips cannot disagree on a name or a suffix.
  const sourceControls =
    opts?.controls ??
    tileSourceControls(slots, {
      device,
      states: opts?.states,
      objects: opts?.objects,
      variables: opts?.variables,
      overrides: opts?.overrides,
      derived: opts?.derived,
      watchOverrides: tile?.watchOverrides,
    });
  const baseScope = ruleScope(sourceControls, pool, opts?.extras);
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
  const resolvedRows: SlotRow[] = pickSlotControls<SlotControl>(
    slots,
    shownControls,
    {
      active,
      raw,
    },
  )
    .filter(
      (r) => r.slot.kind === "frame" || r.slot.kind === "html" || r.control,
    )
    .map((r) => ({
      slot: r.slot,
      control: r.control,
      style: styleOf(r.slot, r.control),
    }));
  const rows = resolvedRows.filter((r) => r.style.hidden !== true);

  // The body is every row that lives on the tile (A59: nothing draws as a
  // layer of its own any more — the chart comes from the rows).
  // The body is every row that draws as a tile body element; a badge-mode
  // slot leaves it for a corner chip (A34).
  const body = rows.filter((r) => slotTileMode(r.slot) === "normal");
  // The detail page is governed by the tile settings alone: the Detail span and
  // the icon/label/value homes. Rules (visibility, colour, icon) and the
  // active/inactive gate never reach it. The pick runs on showWhen-free clones
  // so a face-only slot still gets its row and control.
  const detailSlots = slots.map((s) =>
    s.showWhen ? { ...s, showWhen: undefined } : s,
  );
  const modal: SlotRow[] = pickSlotControls<SlotControl>(
    detailSlots,
    shownControls,
    { active: true, raw },
  )
    .filter(
      (r) => r.slot.kind === "frame" || r.slot.kind === "html" || r.control,
    )
    .map((r) => ({
      slot: r.slot,
      control: r.control,
      style: {},
    }))
    .filter((r) => inDetail(r.slot));

  const badgeSlots = slots.filter(
    (s) => slotVisible(s, active) && slotTileMode(s) === "badge",
  );
  // The detail header mirrors the tile's corner badges: the same chips, rules
  // and label behaviour; only their place changes (left to right of the title).
  const modalBadgeSlots = badgeSlots.filter((s) => inDetail(s));
  const modalBadges = raw
    ? modalBadgeSlots.flatMap((s) =>
        resolveBadges(
          [s],
          device,
          opts?.time,
          opts?.now ?? Date.now(),
          pool,
          raw,
          false,
          sourceControls,
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

/** The tile's face: the first body slot of a face kind. A badge-mode slot is
 *  not the face while a body slot exists; with only badges, one stands in so
 *  the header still has an icon. */
export function tileHeadlineSlot(slots: Slot[]): Slot | undefined {
  const body = slots.filter((s) => slotTileMode(s) === "normal");
  return headlineSlot(body.length ? body : slots);
}

/** The look of the tile's current state (A71). With no active condition the
 *  inactive look still styles the tile, but its glyph is not the face: the
 *  tile's own icon is. A look glyph needs a state to switch between. */
export function stateLook(
  tile: TileConfig | undefined,
  active: boolean,
): StateLook {
  if (!tile) return {};
  if (!tile.active) {
    const rest = { ...(tile.look?.inactive ?? {}) };
    delete rest.glyph;
    return rest;
  }
  return tile.look?.[active ? "active" : "inactive"] ?? {};
}

/** The row whose control a tile-face tap runs: a switch/button shown on the
 *  tile, the headline first. Slot icons do not matter — a control shown in the
 *  tile stays operable from the face even when its icon is detail-only. */
export function faceSwitchRow(
  rows: SlotRow[],
  headline?: SlotRow,
): SlotRow | undefined {
  const actionable = (row: SlotRow | undefined): boolean =>
    !!row?.control &&
    row.control.writable === true &&
    (row.slot.kind === "switch" || row.slot.kind === "button");
  if (headline && actionable(headline)) return headline;
  return rows.find(actionable);
}

/** The glyph of the tile's face: the state's look, then the tile's own icon,
 *  then the headline slot's icon. The slot icon stays the row's own. */
export function faceGlyph(
  look: StateLook,
  tileIcon?: string,
  slotGlyph?: string,
  defaultGlyph?: string,
): string | undefined {
  return look.glyph ?? tileIcon ?? slotGlyph ?? defaultGlyph;
}

/** The icon before the tile name (detail header): the state's look, then the
 *  tile's own icon, then the headline slot's icon. */
export function headerIcon(
  tileIcon: string | undefined,
  look: StateLook,
  headline?: { glyph: string; color?: string; disabled?: boolean },
): { glyph: string; color?: string; disabled?: boolean } | undefined {
  if (look.glyph) return { glyph: look.glyph, color: look.color };
  if (tileIcon) return { glyph: tileIcon };
  if (headline) return headline;
  return undefined;
}

/** The pool default a face may wear: not while the tile has an active condition
 *  (the look pair carries it), not over a device's own icon, and not when the
 *  headline slot's icon was explicitly turned off. */
export function faceDefaultGlyph(args: {
  hasActive: boolean;
  headline?: Slot;
  poolValue?: string;
}): string | undefined {
  if (args.hasActive) return undefined;
  if (args.headline?.icon?.enabled === false) return undefined;
  return args.poolValue;
}

/** The row's own state when it is unambiguously binary, else undefined. */
export function binaryOn(control: SlotControl): boolean | undefined {
  const value = control.liveValue;
  if (typeof value === "boolean") return value;
  const meta = control.meta;
  if (
    typeof value === "number" &&
    (value === 0 || value === 1) &&
    meta?.min === 0 &&
    meta?.max === 1
  ) {
    return value === 1;
  }
  return undefined;
}

/** The icon a resolved row shows in `home` (A51/A54): enabled, glyphed, allowed
 *  there — the last matching rule's glyph beats the descriptor's. A binary state
 *  with a twin in the library draws the half its value asks for. */
export function rowIcon(
  row: SlotRow,
  home: "tile" | "modal",
  twins?: Record<string, string>,
  fallback?: string,
): { glyph: string; color?: string; disabled?: boolean } | undefined {
  const icon = row.slot.icon;
  if (icon?.enabled === false) return undefined;
  if (icon) {
    const where = icon.where ?? "both";
    if (where !== "both" && where !== home) return undefined;
  }
  const picked = row.style.icon ?? (icon ? icon.glyph : fallback);
  if (!picked) return undefined;
  const on = twins && row.control ? binaryOn(row.control) : undefined;
  const glyph =
    on === true
      ? (onTwin(twins!, picked) ?? picked)
      : on === false
        ? (offTwin(twins!, picked) ?? picked)
        : picked;
  // A chip's rule colours are for the corner badge (often text on a filled
  // background). The detail row is a normal line: reusing that colour there can
  // paint an icon invisible (white on white).
  const chip = home === "modal" && slotTileMode(row.slot) === "badge";
  return {
    glyph,
    color: chip ? undefined : row.style.color,
    disabled: row.style.disabled,
  };
}

/** Does the slot's reading/control draw in `home`? `hideValue` turns the body
 *  off, else its own `valueWhere` (absent = both) decides — independent of the
 *  slot's `where`, so an icon can stay on the tile while its value moves. */
export function valueShown(
  options: Record<string, unknown> | undefined,
  home: "tile" | "modal",
): boolean {
  if (options?.hideValue === true) return false;
  const where = options?.valueWhere;
  return where === "tile" || where === "modal" ? where === home : true;
}

/** Does the slot's name draw in `home`? Its own `labelWhere` wins; absent keeps
 *  every name in the detail view — only the tile's own title shows on the tile
 *  by default. */
export function labelShown(
  slot: Pick<Slot, "kind" | "labelWhere">,
  home: "tile" | "modal",
): boolean {
  const where = slot.labelWhere ?? "modal";
  return where === "both" || where === home;
}

/** A lone frame/html slot is the tile's whole face: no name, no padding. */
export function singleSurface(slots: Slot[]): boolean {
  if (slots.length !== 1) return false;
  return slots[0].kind === "frame" || slots[0].kind === "html";
}

// ------------------------------------------------------------------ charts

/** The series colours, in assignment order (A61): theme tokens, so the chart
 *  follows the theme like everything else. */
export type ChartLayout = "band" | "full" | "header";

/** The chart layout, reading the legacy booleans when `mode` is absent. */
export function chartLayout(config?: TileChartConfig): ChartLayout {
  if (config?.mode) return config.mode;
  return config?.full === true || config?.separate === true ? "full" : "band";
}

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
