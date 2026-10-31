// The display defaults a User Interface settings document may carry: the keys,
// their ranges, the CSS custom properties the shell publishes, and the 1×1
// module at a scale. One home, so the page, the shell and the display cannot
// disagree about a value.

import { isHexColor } from "$lib/config/appearance";
import type { Settings } from "$lib/config/settings-ops";
import type { BreakpointDef } from "$lib/config/size-ops";

export const UI_DEFAULTS = {
  primary: 0.9,
  secondary: 0.84,
  tileScale: 1,
  reloadMinutes: 0,
};

export const UI_LIMITS = {
  primary: { min: 0.7, max: 1.6, step: 0.02 },
  secondary: { min: 0.6, max: 1.4, step: 0.02 },
  tileScale: { min: 1, max: 2, step: 0.05 },
  reloadMinutes: { min: 0, max: 1440, step: 1 },
};

export interface UiDefaults {
  pageBackground?: string;
  sectionBackground?: string;
  tileBackground?: string;
  primary: number;
  secondary: number;
  tileScale: number;
  /** Whole minutes between automatic reloads; 0 is off. */
  reloadMinutes: number;
}

function colour(value: unknown): string | undefined {
  const text = typeof value === "string" ? value : undefined;
  return isHexColor(text) ? text : undefined;
}

function number(
  value: unknown,
  limit: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limit.max, Math.max(limit.min, value));
}

export function effectiveUi(settings: Settings): UiDefaults {
  return {
    pageBackground: colour(settings["ui.pageBackground"]),
    sectionBackground: colour(settings["ui.sectionBackground"]),
    tileBackground: colour(settings["ui.tileBackground"]),
    primary: number(
      settings["ui.primaryText"],
      UI_LIMITS.primary,
      UI_DEFAULTS.primary,
    ),
    secondary: number(
      settings["ui.secondaryText"],
      UI_LIMITS.secondary,
      UI_DEFAULTS.secondary,
    ),
    tileScale: number(
      settings["ui.tileScale"],
      UI_LIMITS.tileScale,
      UI_DEFAULTS.tileScale,
    ),
    reloadMinutes: Math.round(
      number(
        settings["ui.reloadMinutes"],
        UI_LIMITS.reloadMinutes,
        UI_DEFAULTS.reloadMinutes,
      ),
    ),
  };
}

/** Whole rem values as CSS wants them: 0.9 → "0.9", 0.75 → "0.75", trailing zeros dropped. */
function rem(value: number): string {
  return `${Math.round(value * 1000) / 1000}rem`;
}

export function uiCss(ui: UiDefaults): string {
  const parts: string[] = [];
  if (ui.pageBackground) parts.push(`--ui-page-bg: ${ui.pageBackground};`);
  if (ui.sectionBackground)
    parts.push(`--ui-section-bg: ${ui.sectionBackground};`);
  if (ui.tileBackground) parts.push(`--ui-tile-bg: ${ui.tileBackground};`);
  parts.push(`--ui-value-size: ${rem(ui.primary)};`);
  // The tile name keeps its current ratio to the main reading (12 px / 14.4 px).
  parts.push(`--ui-name-size: ${rem((ui.primary * 12) / 14.4)};`);
  parts.push(`--ui-secondary-size: ${rem(ui.secondary)};`);
  return parts.join(" ");
}

/** The 1×1 module at a scale, rounded to 0.1 px so the emitted CSS stays short. */
export function scaledTile(
  def: BreakpointDef,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.round(def.tileW * scale * 10) / 10,
    h: Math.round(def.tileH * scale * 10) / 10,
  };
}
