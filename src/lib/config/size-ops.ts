import type { Size } from "$lib/types/display";

export type Breakpoint = "phone" | "tablet" | "desktop";

/** Modules a tile occupies. A hint, clamped per breakpoint — never a coordinate. */
export interface TileSpan {
  w: number;
  h: number;
}

export const DEFAULT_SPAN: Size = { w: 1, h: 1 };

export interface BreakpointDef {
  name: Breakpoint;
  /** Inclusive lower bound in CSS pixels; `breakpointFor` reads this. */
  minWidth: number;
  /** Module size — emitted as the `--tile-min` custom property. */
  tileMin: number;
  /** Column/row span cap — emitted as `--max-w` / `--max-h`. */
  maxW: number;
  maxH: number;
}

/**
 * The single home of the layout numbers (spec §5). The component layer emits
 * these as CSS custom properties, so the stylesheet never repeats a value.
 */
export const BREAKPOINTS: BreakpointDef[] = [
  { name: "phone", minWidth: 0, tileMin: 150, maxW: 1, maxH: 2 },
  { name: "tablet", minWidth: 600, tileMin: 170, maxW: 2, maxH: 2 },
  { name: "desktop", minWidth: 1025, tileMin: 190, maxW: 4, maxH: 4 },
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
