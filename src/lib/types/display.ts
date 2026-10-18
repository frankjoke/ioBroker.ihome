import type { DeviceType } from "$lib/types/device";
import type { FeatureDef } from "$lib/config/features";

/** Tile size hint, 1–4 modules per axis. Clamped per breakpoint — never a coordinate. */
export type Size = { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 | 4 };

/**
 * Group contents. Every field is optional and they are ANDed; an empty member
 * matches nothing (a fresh group must be configured before it shows devices).
 */
export interface Member {
  ids?: string[]; // explicit device ids
  room?: string; // enum.rooms.* id
  function?: string; // enum.functions.* id
  favorite?: string; // enum.favorites.* id
  type?: DeviceType;
  tags?: string[];
}

export interface Background {
  kind: "gradient" | "image" | "solid";
  value: string;
}

/** How a section looks: its own background and whether it draws a border. */
export interface SectionAppearance {
  border?: boolean;
  background?: Background;
}

/**
 * A tile's own config. Absent → resolved from the device → its template →
 * the preset; on the first edit it is materialised (complete, not a patch).
 */
export interface TileConfig {
  template?: string;
  size?: Size;
  /** The tile's CSS background (solid/gradient/image), behind its content. */
  background?: Background;
  /** What "active" means for this tile (A30): evaluated live per render. */
  active?: ActiveCondition;
  slots?: Slot[];
}

/** The basic logic an active condition offers. */
export type ActiveOp = "truthy" | "gt" | "gte" | "lt" | "lte" | "eq" | "ne";

export interface ActiveCondition {
  /** A device control (feature → id → stateId → label), a placeholder hint, or a raw state id. */
  source: string;
  op: ActiveOp;
  /** The right-hand side; unused by `truthy`. Stored as text, compared loosely. */
  value?: string;
}

/** One tile on one section: which device, what it is called there, how it looks. */
export interface Placement {
  id: string;
  device: string;
  title?: string;
  /** Start a new line before this tile even if it would still fit. */
  newLine?: boolean;
  tile?: TileConfig;
}

export interface Group {
  id: string;
  title?: string; // absent → header-less section
  icon?: string;
  /** Filter hint only (A8): a section's members are its `tiles`, not this. */
  member?: Member;
  appearance?: SectionAppearance;
  /** Start a new line before this section even if it would still fit. */
  newLine?: boolean;
  showEmpty?: boolean;
  /** The section's contents, in display order — the truth (A8/A9). */
  tiles?: Placement[];
}

export interface Page {
  id: string;
  title: string;
  icon?: string;
  background?: Background;
  groups: Group[];
}

export interface PageRegistry {
  version: number;
  updatedAt: number;
  seeded?: boolean;
  pages: Page[];
}

/** The closed vocabulary the renderer knows how to draw (spec §6). */
export type SlotKind =
  | "icon"
  | "value"
  | "level"
  | "color"
  | "enum"
  | "button"
  | "badge"
  | "sparkline"
  | "history-list"
  | "frame";

/** A conditional style, evaluated top-to-bottom; the last match wins. */
export interface Rule {
  when: string; // expression, same language as VirtualSpec.expr
  icon?: string; // material-symbols name
  color?: string;
  glow?: boolean;
  background?: string;
  hidden?: boolean;
  /** Show the slot *only* while this rule matches — a visibility gate, not a
   *  style. With gates present and none matching, the slot (or badge) hides. */
  only?: boolean;
  /** Render as switched-off: dimmed. The control stays usable. */
  disabled?: boolean;
  tone?: string; // badge tone: info | ok | warn | danger
}

export interface Slot {
  kind: SlotKind;
  source?: string; // control feature → control id → state id
  /** Another device's control: a tile may show more than its own device (A11). */
  from?: string;
  label?: string;
  unit?: string; // overrides the control's unit when set
  options?: Record<string, unknown>; // per-kind knobs (min/max/step/decimals/…)
  rules?: Rule[];
  /** Render only while the tile is active / inactive (A30); absent = both. */
  showWhen?: "active" | "inactive";
  /** Where the slot lives (A34): the tile (default), the modal, or both. */
  where?: "tile" | "both" | "modal";
}

export interface Template {
  id: string;
  name: string;
  builtin?: boolean;
  basedOn?: string; // preset id this was copied from
  type: DeviceType;
  size?: Size;
  /** The template's CSS background, applied with the tile's (A19). */
  background?: Background;
  features: FeatureDef[]; // what a device of this type must supply
  slots: Slot[];
}

export interface TemplateRegistry {
  version: number;
  updatedAt: number;
  templates: Template[];
}
