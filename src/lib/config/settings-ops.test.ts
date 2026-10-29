import { it, expect } from "vitest";
import {
  effectiveHidePencil,
  effectiveLockPencil,
  layoutNeedsPin,
  mergeSettings,
  missingPin,
  parseSettings,
  settingsDocument,
} from "$lib/config/settings-ops";

it("parseSettings accepts only a readable object", () => {
  expect(parseSettings({ pin: "1234" })).toEqual({ pin: "1234" });
  expect(parseSettings('{"pin":"1234"}')).toEqual({ pin: "1234" });
  expect(parseSettings("")).toBeNull();
  expect(parseSettings("{bad")).toBeNull();
  expect(parseSettings("[1,2]")).toBeNull(); // a JSON array is not settings
  expect(parseSettings(null)).toBeNull();
  expect(parseSettings(42)).toBeNull();
  expect(parseSettings("plain")).toBeNull();
});

it("settingsDocument treats a never-written state as an empty document", () => {
  // A freshly created state has no value: that is "no document yet", not junk.
  expect(settingsDocument(null)).toEqual({});
  expect(settingsDocument(undefined)).toEqual({});
  expect(settingsDocument("")).toEqual({});
  expect(settingsDocument('{"pin":"1234"}')).toEqual({ pin: "1234" });
  // Real junk is still unreadable and is never overwritten on load.
  expect(settingsDocument("{bad")).toBeNull();
  expect(settingsDocument("[1,2]")).toBeNull();
});

it("mergeSettings keeps unknown keys and never mutates its inputs", () => {
  const current = { pin: "1234", future: 7 };
  const patch = { lockPencil: true };
  expect(mergeSettings(current, patch)).toEqual({
    pin: "1234",
    future: 7,
    lockPencil: true,
  });
  expect(current).toEqual({ pin: "1234", future: 7 });
  expect(patch).toEqual({ lockPencil: true });
});

it("missingPin counts anything that is not a valid PIN", () => {
  expect(missingPin({})).toBe(true);
  expect(missingPin({ pin: "12" })).toBe(true);
  expect(missingPin({ pin: 1234 })).toBe(true); // a number is not a PIN
  expect(missingPin({ pin: "1234" })).toBe(false);
});

it("effectiveLockPencil locks only for a real boolean true", () => {
  expect(effectiveLockPencil(true)).toBe(true);
  expect(effectiveLockPencil(false)).toBe(false);
  expect(effectiveLockPencil(undefined)).toBe(false);
  expect(effectiveLockPencil("true")).toBe(false);
  expect(effectiveLockPencil(1)).toBe(false);
});

it("effectiveHidePencil hides only for a real boolean true", () => {
  expect(effectiveHidePencil(true)).toBe(true);
  expect(effectiveHidePencil(false)).toBe(false);
  expect(effectiveHidePencil(undefined)).toBe(false);
  expect(effectiveHidePencil("true")).toBe(false);
});

it("layoutNeedsPin asks only with the flag on and the session locked", () => {
  expect(layoutNeedsPin(true, false)).toBe(true);
  expect(layoutNeedsPin(true, true)).toBe(false); // one unlock covers the session
  expect(layoutNeedsPin(false, false)).toBe(false); // ships off
  expect(layoutNeedsPin(undefined, false)).toBe(false);
});
