import { beforeEach, expect, it, vi } from "vitest";
import {
  ICON_SOURCE_DEFAULTS,
  readIconSourcePrefs,
  writeIconSourcePrefs,
} from "./icon-source-prefs";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

it("round-trips the last adapter folder", () => {
  writeIconSourcePrefs({
    resource: "adapter",
    basePath: "icons-freepic/",
    folder: "/icons-freepic/gadgets/",
    downloadCopy: false,
  });
  expect(readIconSourcePrefs()).toEqual({
    resource: "adapter",
    basePath: "icons-freepic/",
    folder: "/icons-freepic/gadgets/",
    downloadCopy: false,
  });
});

it("falls back to the defaults for junk and unknown resources", () => {
  globalThis.localStorage.setItem("iHome.iconSource", "not json");
  expect(readIconSourcePrefs()).toEqual(ICON_SOURCE_DEFAULTS);
  globalThis.localStorage.setItem(
    "iHome.iconSource",
    JSON.stringify({ resource: "nope", folder: 7 }),
  );
  expect(readIconSourcePrefs().resource).toBe("library");
  expect(readIconSourcePrefs().folder).toBe(ICON_SOURCE_DEFAULTS.folder);
});

it("keeps known fields when the stored object is partial", () => {
  globalThis.localStorage.setItem(
    "iHome.iconSource",
    JSON.stringify({ resource: "adapter", folder: "/icons-freepic/x/" }),
  );
  const prefs = readIconSourcePrefs();
  expect(prefs.resource).toBe("adapter");
  expect(prefs.folder).toBe("/icons-freepic/x/");
  expect(prefs.basePath).toBe(ICON_SOURCE_DEFAULTS.basePath);
  expect(prefs.downloadCopy).toBe(true);
});
