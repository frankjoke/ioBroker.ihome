import { it, expect, vi } from "vitest";
import {
  DEFAULT_PIN,
  PIN_STORAGE_KEY,
  effectivePin,
  isDefaultPin,
  isUnlocked,
  isValidPin,
  lock,
  unlock,
} from "$lib/config/pin.svelte";

it("isValidPin takes digits-only 4-6 and nothing else", () => {
  expect(isValidPin("4321")).toBe(true);
  expect(isValidPin("12345")).toBe(true);
  expect(isValidPin("123456")).toBe(true);
  expect(isValidPin("123")).toBe(false);
  expect(isValidPin("1234567")).toBe(false);
  expect(isValidPin("12a4")).toBe(false);
  expect(isValidPin("1234 ")).toBe(false);
  expect(isValidPin(" 1234")).toBe(false);
  expect(isValidPin("")).toBe(false);
  expect(isValidPin(null)).toBe(false);
  expect(isValidPin(undefined)).toBe(false);
  expect(isValidPin(4321)).toBe(false); // a number is not a PIN
});

it("isDefaultPin counts a missing or malformed value as still on the default", () => {
  expect(isDefaultPin("")).toBe(true);
  expect(isDefaultPin(undefined)).toBe(true);
  expect(isDefaultPin(null)).toBe(true);
  expect(isDefaultPin("4321")).toBe(true);
  expect(isDefaultPin("not-a-pin")).toBe(true); // a hand-edited key cannot stick
  expect(isDefaultPin("12345")).toBe(false);
  expect(isDefaultPin("0000")).toBe(false);
});

it("effectivePin falls back to the default, never to a lockout", () => {
  expect(effectivePin("9876")).toBe("9876");
  expect(effectivePin("")).toBe("4321");
  expect(effectivePin("not-a-pin")).toBe("4321");
});

it("the shipped default and the storage key are the constants", () => {
  expect(DEFAULT_PIN).toBe("4321");
  // The layout's defineStorage composes "__VISUAL__:pin" from this name.
  expect(PIN_STORAGE_KEY).toBe("pin");
});

it("the unlock flag lives in memory only", () => {
  expect(isUnlocked()).toBe(false);
  unlock();
  expect(isUnlocked()).toBe(true);
  lock();
  expect(isUnlocked()).toBe(false);
});

it("a fresh module instance is locked again (a reload re-locks)", async () => {
  unlock();
  expect(isUnlocked()).toBe(true);
  vi.resetModules();
  const fresh = await import("$lib/config/pin.svelte");
  expect(fresh.isUnlocked()).toBe(false);
});

it("unlocking persists nothing: no localStorage is touched", () => {
  const g = globalThis as { localStorage?: unknown };
  expect("localStorage" in g).toBe(false);
  unlock();
  expect("localStorage" in g).toBe(false);
  lock();
});
