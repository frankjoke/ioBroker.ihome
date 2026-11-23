import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { createLongPress } from "$lib/utils/long-press";

let fired: Array<[number, number]>;

beforeEach(() => {
  vi.useFakeTimers();
  fired = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const press = () =>
  createLongPress({
    delay: 500,
    tolerance: 8,
    onTrigger: (x, y) => fired.push([x, y]),
  });

it("fires once at the start point after the delay", () => {
  const p = press();
  p.down(10, 20);
  vi.advanceTimersByTime(499);
  expect(fired).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(fired).toEqual([[10, 20]]);
  expect(p.triggered).toBe(true);
  vi.advanceTimersByTime(5000);
  expect(fired).toEqual([[10, 20]]);
});

it("cancels when the finger moves beyond the tolerance", () => {
  const p = press();
  p.down(10, 10);
  p.move(19, 10);
  vi.advanceTimersByTime(600);
  expect(fired).toEqual([]);
  expect(p.triggered).toBe(false);
});

it("still fires after a small wobble", () => {
  const p = press();
  p.down(10, 10);
  p.move(17, 15); // 8.06 px — just over 8
  vi.advanceTimersByTime(600);
  expect(fired).toEqual([]);

  const q = press();
  q.down(10, 10);
  q.move(16, 14); // 7.2 px — inside the tolerance
  vi.advanceTimersByTime(600);
  expect(fired).toEqual([[10, 10]]);
});

it("cancels on release and on cancel", () => {
  const p = press();
  p.down(1, 1);
  p.up();
  vi.advanceTimersByTime(600);
  expect(fired).toEqual([]);

  const q = press();
  q.down(1, 1);
  q.cancel();
  vi.advanceTimersByTime(600);
  expect(fired).toEqual([]);
});

it("keeps the trigger flag until the next press", () => {
  const p = press();
  p.down(2, 3);
  vi.advanceTimersByTime(500);
  p.up();
  expect(p.triggered).toBe(true);
  p.down(4, 5);
  expect(p.triggered).toBe(false);
});

it("consumes the trigger once so later clicks are not swallowed", () => {
  const p = press();
  p.down(7, 8);
  vi.advanceTimersByTime(500);
  expect(p.consume()).toBe(true);
  expect(p.consume()).toBe(false);
  expect(p.triggered).toBe(false);
});
