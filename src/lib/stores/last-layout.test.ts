import { beforeEach, expect, it, vi } from "vitest";
import { readLastLayout, writeLastLayout } from "./last-layout";
import type { LayoutSelection } from "$lib/config/layout-ops";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

const tile: LayoutSelection = {
  kind: "tile",
  pageId: "home",
  sectionId: "main",
  placementId: "t1",
};

it("round-trips the last edited selection", () => {
  writeLastLayout(tile);
  expect(readLastLayout()).toEqual(tile);
});

it("ignores junk and clears on null", () => {
  globalThis.localStorage.setItem("iHome.lastLayout", "not json");
  expect(readLastLayout()).toBeNull();
  writeLastLayout(tile);
  writeLastLayout(null);
  expect(readLastLayout()).toBeNull();
});
