import { beforeEach, expect, it, vi } from "vitest";

let settingsLoaded = true;
let lockPencil = false;
let unlocked = false;

beforeEach(() => {
  vi.resetModules();
  settingsLoaded = true;
  lockPencil = false;
  unlocked = false;
  vi.doMock("$lib/stores/settings.svelte", () => ({
    isSettingsLoaded: () => settingsLoaded,
    getSettings: () => ({ lockPencil }),
  }));
  vi.doMock("$lib/config/pin.svelte", () => ({
    isUnlocked: () => unlocked,
  }));
});

async function gate() {
  return import("$lib/stores/sheet.svelte");
}

it("opens the sheet directly while the pencil lock is off", async () => {
  const { openSheetGated, isPinAsked, sheet } = await gate();
  openSheetGated();
  expect(sheet.open).toBe(true);
  expect(isPinAsked()).toBe(false);
});

it("asks before opening the sheet while the pencil lock is on", async () => {
  lockPencil = true;
  const { openSheetGated, isPinAsked, pinAskTitle, resolvePinAsk, sheet } =
    await gate();
  openSheetGated();
  expect(sheet.open).toBe(false);
  expect(isPinAsked()).toBe(true);
  expect(pinAskTitle()).toBe("Enter PIN for the layout editor");

  resolvePinAsk(true);
  expect(sheet.open).toBe(true);
  expect(isPinAsked()).toBe(false);
});

it("runs a gated action after the PIN and only once", async () => {
  lockPencil = true;
  let calls = 0;
  const { isPinAsked, pinAskTitle, resolvePinAsk, runSheetGated } =
    await gate();
  runSheetGated(() => calls++, "Enter PIN to delete the tile");
  expect(calls).toBe(0);
  expect(isPinAsked()).toBe(true);
  expect(pinAskTitle()).toBe("Enter PIN to delete the tile");

  resolvePinAsk(true);
  expect(calls).toBe(1);
  resolvePinAsk(true);
  expect(calls).toBe(1);
});

it("drops a gated action when the ask is cancelled", async () => {
  lockPencil = true;
  let calls = 0;
  const { isPinAsked, resolvePinAsk, runSheetGated } = await gate();
  runSheetGated(() => calls++);
  resolvePinAsk(false);
  expect(calls).toBe(0);
  expect(isPinAsked()).toBe(false);
});

it("runs a gated action directly once the session is unlocked", async () => {
  lockPencil = true;
  unlocked = true;
  let calls = 0;
  const { isPinAsked, runSheetGated } = await gate();
  runSheetGated(() => calls++);
  expect(calls).toBe(1);
  expect(isPinAsked()).toBe(false);
});

it("asks while the settings document has not been read", async () => {
  settingsLoaded = false;
  let calls = 0;
  const { isPinAsked, runSheetGated } = await gate();
  runSheetGated(() => calls++);
  expect(calls).toBe(0);
  expect(isPinAsked()).toBe(true);
});
