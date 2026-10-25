import type { Size } from "$lib/types/display";

export type Breakpoint = "phone" | "tablet" | "desktop";

/** Modules a tile occupies. A hint, clamped per breakpoint — never a coordinate. */
export interface TileSpan {
  w: number;
  h: number;
}

export const DEFAULT_SPAN: Size = { w: 1, h: 1 };

/**
 * The largest hint a document may carry (A2). A breakpoint may still clamp to
 * less than this — the editor writes up to here, the type names it.
 */
export const SIZE_MAX = 10;

export interface BreakpointDef {
  name: Breakpoint;
  /** Inclusive lower bound in CSS pixels; `breakpointFor` reads this. */
  minWidth: number;
  /**
   * Column module (`--tile-w`) and row module (`--tile-h`).
   *
   * The column module is **half** the row module, because a tile's `w` is
   * counted in half-modules: `w: 1` is a half-width card, `w: 2` the width a
   * plain tile used to have. CSS `span` only takes integers, so a finer column
   * is how a "0.5 wide" tile is expressed.
   *
   * These are *minimums*: the row track is `minmax(--tile-h, auto)`, so a tile
   * with more content grows instead of clipping its values. Font and icon sizes
   * are untouched by design — tightening the module must never shrink what you
   * read.
   */
  tileW: number;
  tileH: number;
  /**
   * How far a tile may stretch at this breakpoint. It must stay within what a
   * page of this breakpoint can show — the tile renders its own span while the
   * layout pass clamps only the section (see the guard test).
   */
  maxW: number;
  maxH: number;
}

/**
 * The single home of the layout numbers (spec §5). The component layer emits
 * these as CSS custom properties, so the stylesheet never repeats a value.
 */
export const BREAKPOINTS: BreakpointDef[] = [
  { name: "phone", minWidth: 0, tileW: 45, tileH: 90, maxW: 2, maxH: 2 },
  {
    name: "tablet",
    minWidth: 600,
    tileW: 51,
    tileH: 102,
    maxW: SIZE_MAX,
    maxH: SIZE_MAX,
  },
  {
    name: "desktop",
    minWidth: 1025,
    tileW: 57,
    tileH: 114,
    maxW: SIZE_MAX,
    maxH: SIZE_MAX,
  },
];

/** The breakpoint a viewport width falls in: phone <600, tablet 600–1024, desktop >1024. */
export function breakpointFor(width: number): Breakpoint {
  let current = BREAKPOINTS[0];
  for (const bp of BREAKPOINTS) {
    if (bp.minWidth <= width) current = bp;
  }
  return current.name;
}

function cap(value: number | undefined, max: number): number {
  const n = Math.trunc(Number(value ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

/** Clamp a size hint to what the breakpoint can actually show. */
export function clampSpan(size: Size | undefined, bp: Breakpoint): TileSpan {
  const def = BREAKPOINTS.find((b) => b.name === bp) ?? BREAKPOINTS[0];
  return { w: cap(size?.w, def.maxW), h: cap(size?.h, def.maxH) };
}

/**
 * A tile's rendered columns: its own span, never wider than the section that
 * holds it. A scaled 1×1 module fits fewer columns than the static cap allows,
 * so a wide tile would otherwise leave its section's box. `modules = 0` is the
 * fluid/preview case (auto-fill), where there is no fixed width to clamp to.
 */
export function tileColumns(spanW: number, modules: number): number {
  return modules > 0 ? Math.min(spanW, modules) : spanW;
}
