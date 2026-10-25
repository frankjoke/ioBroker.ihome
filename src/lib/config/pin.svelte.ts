// The PIN that stands in front of the configuration, and the only home of its
// rule: digits, 4 to 6 characters, default "4321". Routes and components call
// this module instead of restating the rule.
//
// What it guards: every route that is not the display (Devices, Global
// Variables, Formula Templates, Server & Security) and every entrance into the
// layout editor — the AppBar pencil, a Ctrl/Cmd+click on a page tab, a tile or
// a section header. Without the PIN the app shows the configured UI and
// nothing that changes it.
//
// The stored value lives in localStorage["__VISUAL__:pin"], written by the
// layout's defineStorage call under the app's existing "__VISUAL__:" prefix —
// plaintext and per device. This is a convenience lock, NOT a security
// boundary: anyone with devtools on this device (or with the broker access this
// app already has) can read or delete the key and walk in. The lock keeps a
// curious tap on the wall display away from the config; it protects nothing on
// the broker.
//
// Removing "__VISUAL__:pin" is still the recovery recipe: the default returns,
// so "4321" opens the page again and the next connection save re-arms the forced
// change. The in-app change UI is the Security card in Settings.
//
// Per-tile detail PINs live on the tile itself (TileConfig.pin): a tile that
// has one asks for it on every open of its detail page, and only there — see
// tileNeedsPin below. They are the tile's own config, so they travel with the
// pages document, not with localStorage, and they never reach the settings:
// this PIN opens a detail page, not the app.
//
// The unlock flag at the bottom is module state, so a reload locks everything
// again — nothing about "unlocked" is persisted. One unlock covers the session:
// every gate reads the same flag.

export const DEFAULT_PIN = "4321";

/** The name the layout's defineStorage call composes into `__VISUAL__:pin`. */
export const PIN_STORAGE_KEY = "pin";

/** Digits only, 4 to 6, as a string — a number is not a PIN. */
export function isValidPin(value: unknown): boolean {
  return typeof value === "string" && /^[0-9]{4,6}$/.test(value);
}

/** Still on the shipped default: anything missing, empty or malformed counts. */
export function isDefaultPin(value: unknown): boolean {
  return !isValidPin(value) || value === DEFAULT_PIN;
}

/** What the prompt compares against; a corrupt stored value falls back to the
 *  default, so a hand-edited key can never lock the operator out. */
export function effectivePin(stored: unknown): string {
  return typeof stored === "string" && isValidPin(stored)
    ? stored
    : DEFAULT_PIN;
}

/** The layout's own entrance rule: every route but the display needs the PIN,
 *  and the session is unlocked for all of them at once. */
export function configNeedsPin(isDisplay: boolean, unlocked: boolean): boolean {
  return !isDisplay && !unlocked;
}

/** A tile's own PIN guards its detail page, and only there: with no detail
 *  page there is nothing to open, and anything but a valid PIN (empty, a
 *  half-typed draft, junk) leaves the tile as open as it always was. Unlike the
 *  pencil flag this is not a session unlock — every open asks again. */
export function tileNeedsPin(pin: unknown, hasDetail: boolean): boolean {
  return hasDetail && isValidPin(pin);
}

let unlocked = $state(false);

export function isUnlocked(): boolean {
  return unlocked;
}

export function unlock(): void {
  unlocked = true;
}

export function lock(): void {
  unlocked = false;
}
