// The PIN that stands in front of the configuration UI, and the only home of
// its rule: digits, 4 to 6 characters, default "4321". Routes and components
// call this module instead of restating the rule.
//
// The stored value lives in localStorage["__VISUAL__:pin"], written by the
// layout's defineStorage call under the app's existing "__VISUAL__:" prefix —
// plaintext and per device. This is a convenience lock, NOT a security
// boundary: anyone with devtools on this device (or with the broker access this
// app already has) can read or delete the key and walk in. The lock keeps a
// curious tap on the wall display away from the broker address and the formula
// templates; it protects nothing on the broker.
//
// Removing "__VISUAL__:pin" is still the recovery recipe: the default returns,
// so "4321" opens the page again and the next connection save re-arms the forced
// change. The in-app change UI is the PIN card in Settings.
//
// Per-tile detail PINs and a "pencil needs a PIN" flag are out of scope: no
// schema field and no migration were added for them.
//
// The unlock flag at the bottom is module state, so a reload locks the route
// again — nothing about "unlocked" is persisted.

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
