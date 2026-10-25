// Everything the settings document is allowed to be: parse, merge, and the two
// rules that read it (the PIN seeding predicate, the layout editor's lock).
// The store and the layout call this module instead of restating them.

import { isValidPin } from "$lib/config/pin.svelte";

export type Settings = Record<string, unknown>;

export function parseSettings(raw: unknown): Settings | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Settings;
}

export function mergeSettings(
  current: Settings,
  patch: Partial<Settings>,
): Settings {
  return { ...current, ...patch };
}

export function missingPin(settings: Settings): boolean {
  return !isValidPin(settings.pin);
}

export function effectiveLockPencil(value: unknown): boolean {
  return value === true;
}

export function layoutNeedsPin(
  lockPencil: unknown,
  unlocked: boolean,
): boolean {
  return effectiveLockPencil(lockPencil) && !unlocked;
}
