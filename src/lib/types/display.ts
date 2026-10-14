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

export interface Group {
  id: string;
  title?: string; // absent → header-less section
  icon?: string;
  member: Member;
  showEmpty?: boolean;
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
  | "history-list";

/** A conditional style, evaluated top-to-bottom; the last match wins. */
export interface Rule {
  when: string; // expression, same language as VirtualSpec.expr
  icon?: string; // material-symbols name
  color?: string;
  glow?: boolean;
  background?: string;
  hidden?: boolean;
  tone?: string; // badge tone: info | ok | warn | danger
}

export interface Slot {
  kind: SlotKind;
  source?: string; // control feature → control id → state id
  label?: string;
  unit?: string; // overrides the control's unit when set
  options?: Record<string, unknown>; // per-kind knobs (min/max/step/decimals/…)
  rules?: Rule[];
}

export interface Template {
  id: string;
  name: string;
  builtin?: boolean;
  basedOn?: string; // preset id this was copied from
  type: DeviceType;
  size?: Size;
  features: FeatureDef[]; // what a device of this type must supply
  slots: Slot[];
}

export interface TemplateRegistry {
  version: number;
  updatedAt: number;
  templates: Template[];
}
