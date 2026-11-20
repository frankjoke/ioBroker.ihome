import { afterEach, beforeEach, expect, it, vi } from "vitest";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("remembers scroll, open item and tab per route", async () => {
  const { patchView, readView } = await import("./page-view");
  patchView("/logic", { openId: "charging", scrollY: 420 });
  patchView("/templates", { tab: "code", openId: "f1", kind: "formula" });
  expect(readView("/logic")).toEqual({ openId: "charging", scrollY: 420 });
  expect(readView("/templates")).toMatchObject({
    tab: "code",
    openId: "f1",
    kind: "formula",
  });
});

it("patches without dropping the other fields", async () => {
  const { patchView, readView } = await import("./page-view");
  patchView("/logic", { openId: "charging", scrollY: 420 });
  patchView("/logic", { openId: null });
  expect(readView("/logic")).toEqual({ openId: null, scrollY: 420 });
});

it("persists to sessionStorage on flush and reads it back", async () => {
  const first = await import("./page-view");
  first.patchView("/logic", { openId: "d1", scrollY: 88 });
  first.flushViews();
  expect(storage.getItem("iHome.pageView")).toContain("d1");

  vi.resetModules();
  const second = await import("./page-view");
  expect(second.readView("/logic")).toMatchObject({
    openId: "d1",
    scrollY: 88,
  });
});

it("ignores malformed storage", async () => {
  storage.setItem("iHome.pageView", "{not json");
  const { readView } = await import("./page-view");
  expect(readView("/logic")).toBeUndefined();
});

it("works without sessionStorage", async () => {
  vi.stubGlobal("sessionStorage", undefined);
  const { patchView, readView, flushViews } = await import("./page-view");
  patchView("/logic", { openId: "x" });
  expect(readView("/logic")).toEqual({ openId: "x" });
  expect(() => flushViews()).not.toThrow();
});
