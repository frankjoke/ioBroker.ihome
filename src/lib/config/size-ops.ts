import type { Size } from "$lib/types/display";

export type Breakpoint = "phone" | "tablet" | "desktop";

/**
 * Modules a tile occupies. A hint, clamped per breakpoint — never a coordinate.
 * A unit is half of the card an older document called 1×1: `w: 2, h: 2` is that
 * card, `w: 2, h: 1` a short button, `w: 1, h: 1` a small one.
 */
export interface TileSpan {
  w: number;
  h: number;
}

export const DEFAULT_SPAN: Size = { w: 2, h: 2 };

/**
 * The largest hint a document may carry (A2). A breakpoint may still clamp to
 * less than this — the editor writes up to here, the type names it. Doubled for
 * the finer module (the old 20×10 cap).
 */
export const SIZE_MAX_W = 40;
export const SIZE_MAX_H = 20;

/**
 * The stored unit of every size in a document. Bumped from 1 when the module
 * was halved; a registry without the marker carries the old unit and is
 * migrated once (a 2×2 is that old 1×1).
 */
export const SIZE_UNIT = 2;

/** A stored size in the current fine unit, for a document still on unit 1. */
export function scaleSize(size: Size): Size {
  return {
    w: Math.min(size.w * SIZE_UNIT, SIZE_MAX_W),
    h: Math.min(size.h * SIZE_UNIT, SIZE_MAX_H),
  } as Size;
}

export interface BreakpointDef {
  name: Breakpoint;
  /** Inclusive lower bound in CSS pixels; `breakpointFor` reads this. */
  minWidth: number;
  /**
   * Column module (`--tile-w`) and row module (`--tile-h`).
   *
   * A module is half of the old one, so a 2×2 tile is the card an old document
   * called 1×1. It is `(old − 6px gap) / 2 + 1`: the gap is part of every span,
   * so absorbing it keeps a 2-span within 2px of the old card instead of 6px
   * wider (the approved +2px width; height stays exact).
   *
   * These are *minimums*: the row track is `minmax(--tile-h, auto)`, so a tile
   * with more content grows instead of clipping its values. Font and icon sizes
   * are untouched by design — tightening the module must never shrink what you
   * read.
   */
  tileW: number;
  tileH: number;
  /**
   * How far a tile may stretch at this breakpoint. Every breakpoint shows the
   * hint whole; the rendered width is clamped to the page's modules by
   * `layoutSection` and to the section by `tileColumns`, so a hint wider than
   * the screen cannot leave its box.
   */
  maxW: number;
  maxH: number;
}

/**
 * The single home of the layout numbers (spec §5). The component layer emits
 * these as CSS custom properties, so the stylesheet never repeats a value.
 */
export const BREAKPOINTS: BreakpointDef[] = [
  {
    name: "phone",
    minWidth: 0,
    tileW: 28.5,
    tileH: 58,
    maxW: SIZE_MAX_W,
    maxH: SIZE_MAX_H,
  },
  {
    name: "tablet",
    minWidth: 600,
    tileW: 23.5,
    tileH: 48,
    maxW: SIZE_MAX_W,
    maxH: SIZE_MAX_H,
  },
  {
    name: "desktop",
    minWidth: 1025,
    tileW: 26.5,
    tileH: 54,
    maxW: SIZE_MAX_W,
    maxH: SIZE_MAX_H,
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
  const hint = size ?? DEFAULT_SPAN;
  return { w: cap(hint.w, def.maxW), h: cap(hint.h, def.maxH) };
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
