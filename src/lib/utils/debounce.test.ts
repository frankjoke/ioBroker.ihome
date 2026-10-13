import { describe, it, expect, vi } from "vitest";
import { debounce } from "$lib/utils/debounce";

describe("debounce", () => {
  it("coalesces rapid calls into one, on the trailing edge", () => {
    vi.useFakeTimers();
    let n = 0;
    const d = debounce(() => n++, 300);
    d();
    d();
    d();
    expect(n).toBe(0);
    vi.advanceTimersByTime(299);
    expect(n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(n).toBe(1);
    vi.useRealTimers();
  });

  it("calls with the latest arguments", () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const d = debounce((v: number) => seen.push(v), 100);
    d(1);
    d(2);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([2]);
    vi.useRealTimers();
  });
});
