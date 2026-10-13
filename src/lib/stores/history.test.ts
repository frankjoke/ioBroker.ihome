import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setHistoryClient,
  ensureHistory,
  readHistory,
  noteLive,
  type HistoryClient,
} from "$lib/stores/history.svelte";
import type { HistorySpec } from "$lib/types/device";

const spec: HistorySpec = { duration: 24, durationUnit: "hours", count: 200 };

function client(
  getHistory: HistoryClient["getHistory"],
  connected = true,
): HistoryClient {
  return { connected, getHistory };
}

beforeEach(() => setHistoryClient(null));

describe("ensureHistory / readHistory", () => {
  it("marks empty when the range has no points", async () => {
    setHistoryClient(client(async () => []));
    ensureHistory("a.0.empty", spec);
    await vi.waitFor(() =>
      expect(readHistory("a.0.empty", spec)?.status).toBe("empty"),
    );
  });

  it("marks error with a message when getHistory rejects", async () => {
    setHistoryClient(
      client(async () => {
        throw new Error("no history adapter");
      }),
    );
    ensureHistory("a.0.err", spec);
    await vi.waitFor(() =>
      expect(readHistory("a.0.err", spec)?.status).toBe("error"),
    );
    expect(readHistory("a.0.err", spec)?.error).toContain("no history adapter");
  });

  it("does not fetch while disconnected", () => {
    let calls = 0;
    setHistoryClient(
      client(async () => {
        calls++;
        return [];
      }, false),
    );
    ensureHistory("a.0.off", spec);
    expect(readHistory("a.0.off", spec)).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("reduces the response to { ts, val } pairs", async () => {
    setHistoryClient(
      client(async () => [{ ts: 1, val: 5, from: "x", ack: true }]),
    );
    ensureHistory("a.0.pairs", spec);
    await vi.waitFor(() =>
      expect(readHistory("a.0.pairs", spec)?.status).toBe("ready"),
    );
    expect(readHistory("a.0.pairs", spec)?.series).toEqual([{ ts: 1, val: 5 }]);
  });
});

describe("noteLive", () => {
  it("appends strictly newer points and ignores older/equal ones", async () => {
    const t0 = Date.now();
    setHistoryClient(client(async () => [{ ts: t0, val: 1 }]));
    ensureHistory("a.0.live", spec);
    await vi.waitFor(() =>
      expect(readHistory("a.0.live", spec)?.status).toBe("ready"),
    );

    noteLive("a.0.live", spec, { ts: t0, val: 9 });
    expect(readHistory("a.0.live", spec)?.series).toEqual([{ ts: t0, val: 1 }]);

    noteLive("a.0.live", spec, { ts: t0 + 1_000, val: 2 });
    noteLive("a.0.live", spec, { ts: t0 + 2_000, val: 3 });
    expect(readHistory("a.0.live", spec)?.series).toEqual([
      { ts: t0, val: 1 },
      { ts: t0 + 1_000, val: 2 },
      { ts: t0 + 2_000, val: 3 },
    ]);
  });

  it("is a no-op before the series has loaded", () => {
    setHistoryClient(client(async () => []));
    expect(() => noteLive("a.0.none", spec, { ts: 1, val: 1 })).not.toThrow();
    expect(readHistory("a.0.none", spec)).toBeUndefined();
  });
});
