import { expect, it, vi } from "vitest";

// tools.svelte.js reads `document` at import time (getVisibility).
vi.stubGlobal("document", {
  readyState: "complete",
  visibilityState: "visible",
});
const { RELOAD_AFTER_HIDDEN_MS, onEditorPage, reloadOnReturn } =
  await import("$lib/tools.svelte.js");

it("leaves config pages alone", () => {
  expect(onEditorPage("/config/devices")).toBe(true);
  expect(onEditorPage("/p/rooms")).toBe(false);
});

it("keeps the page for a short look away", () => {
  expect(reloadOnReturn(0, RELOAD_AFTER_HIDDEN_MS)).toBe(false);
});

it("reloads after more than five minutes out of sight", () => {
  expect(reloadOnReturn(0, RELOAD_AFTER_HIDDEN_MS + 1)).toBe(true);
});
