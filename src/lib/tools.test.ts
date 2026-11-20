import { expect, it, vi } from "vitest";

// tools.svelte.js reads `document` at import time (getVisibility).
vi.stubGlobal("document", {
  readyState: "complete",
  visibilityState: "visible",
});
const {
  RELOAD_AFTER_HIDDEN_MS,
  canReload,
  onDisplayRoute,
  onEditorPage,
  reloadOnReturn,
  routePath,
} = await import("$lib/tools.svelte.js");

it("reads the hash route over the pathname", () => {
  expect(routePath("/ihome/", "#/logic")).toBe("/logic");
  expect(routePath("/ihome/", "")).toBe("/ihome/");
});

it("reloads only in the display's view mode", () => {
  expect(onDisplayRoute("/")).toBe(true);
  expect(onDisplayRoute("/layout")).toBe(true);
  expect(onDisplayRoute("/p/rooms")).toBe(true);
  expect(onDisplayRoute("/ihome/p/rooms")).toBe(true);
  expect(onDisplayRoute("/logic")).toBe(false);
  expect(canReload("/p/rooms", false)).toBe(true);
  expect(canReload("/", true)).toBe(false);
  expect(canReload("/logic", false)).toBe(false);
});

it("leaves editor pages alone", () => {
  expect(onEditorPage("/config/templates")).toBe(true);
  expect(onEditorPage("/ihome/config/templates")).toBe(true);
  expect(onEditorPage("/logic")).toBe(true);
  expect(onEditorPage("/ihome/logic")).toBe(true);
  expect(onEditorPage("/p/rooms")).toBe(false);
  expect(onEditorPage("/ihome/p/rooms")).toBe(false);
});

it("keeps the page for a short look away", () => {
  expect(reloadOnReturn(0, RELOAD_AFTER_HIDDEN_MS)).toBe(false);
});

it("reloads after more than five minutes out of sight", () => {
  expect(reloadOnReturn(0, RELOAD_AFTER_HIDDEN_MS + 1)).toBe(true);
});
