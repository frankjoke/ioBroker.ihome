import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast, toasts } from "./toasts.svelte";

beforeEach(() => {
  vi.useFakeTimers();
  toast.clear();
});

afterEach(() => {
  toast.clear();
  vi.useRealTimers();
});

it("adds a toast and auto-dismisses it", () => {
  toast.info("hello");
  expect(toasts.items).toHaveLength(1);
  expect(toasts.items[0]).toMatchObject({ level: "info", message: "hello" });

  vi.advanceTimersByTime(6000);
  expect(toasts.items).toHaveLength(0);
});

it("keeps a sticky toast until it is dismissed", () => {
  toast.warning("adapter down", { sticky: true });
  vi.advanceTimersByTime(60_000);
  expect(toasts.items).toHaveLength(1);

  toast.dismiss(toasts.items[0].id);
  expect(toasts.items).toHaveLength(0);
});

it("updates a toast with the same key instead of stacking", () => {
  toast.error("no connection", { key: "connection", sticky: true });
  toast.error("still no connection", { key: "connection", sticky: true });

  expect(toasts.items).toHaveLength(1);
  expect(toasts.items[0].message).toBe("still no connection");
});

it("dismisses by key", () => {
  toast.warning("adapter down", { key: "adapter", sticky: true });
  toast.dismissKey("adapter");
  expect(toasts.items).toHaveLength(0);
});

it("keeps at most three non-sticky toasts", () => {
  toast.info("one");
  toast.info("two");
  toast.info("three");
  toast.info("four");

  expect(toasts.items.map((t) => t.message)).toEqual(["two", "three", "four"]);
});
