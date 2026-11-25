import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DerivedHistoryService,
  type RuntimeDerivedEntry,
} from "./history-derived";
import { compileDerivedFunction } from "./history-derived-runtime";

const mean = compileDerivedFunction(
  "const v = samples.filter(s => typeof s.val === 'number'); return v.length ? mean(v.map(s => s.val)) : NOOP;",
);

function entry(over: Partial<RuntimeDerivedEntry> = {}): RuntimeDerivedEntry {
  return {
    id: "0_userdata.0.T",
    adapter: "history.0",
    intervalMs: 10_000,
    startDelayMs: 1_000,
    changesOnly: true,
    relogMs: 60_000,
    run: mean,
    ...over,
  };
}

function service(
  t: RuntimeDerivedEntry[],
  sendTo = vi.fn(async () => ({ success: true })),
) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    sendTo,
    log,
    svc: new DerivedHistoryService({
      namespace: "ihome.0",
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      sendTo,
      log,
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

it("anchors at now + delay and writes the scheduled window end", async () => {
  const h = service([entry()]);
  h.svc.load([entry()]);
  h.svc.onStateChange("0_userdata.0.T", { ts: 2_000, val: 10 });
  h.svc.onStateChange("0_userdata.0.T", { ts: 8_000, val: 20 });
  await vi.advanceTimersByTimeAsync(11_000);
  expect(h.sendTo).toHaveBeenCalledTimes(1);
  const [, , payload] = h.sendTo.mock.calls[0];
  expect(payload).toEqual({
    id: "0_userdata.0.T",
    state: [{ ts: 11_000, val: 15, ack: true, from: "ihome.0" }],
  });
});

it("splits windows and carries the previous value", async () => {
  const h = service([entry({ intervalMs: 10_000, startDelayMs: 0 })]);
  h.svc.load([entry({ intervalMs: 10_000, startDelayMs: 0 })]);
  h.svc.onStateChange("0_userdata.0.T", { ts: 1_000, val: 10 });
  await vi.advanceTimersByTimeAsync(10_000);
  h.svc.onStateChange("0_userdata.0.T", { ts: 11_000, val: 30 });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.sendTo).toHaveBeenCalledTimes(2);
  expect(h.sendTo.mock.calls[0][2].state[0].ts).toBe(10_000);
  expect(h.sendTo.mock.calls[0][2].state[0].val).toBe(10);
  expect(h.sendTo.mock.calls[1][2].state[0].ts).toBe(20_000);
  expect(h.sendTo.mock.calls[1][2].state[0].val).toBe(30);
});

it("skips equal values and writes again at the relog boundary", async () => {
  const run = () => 5;
  const h = service([
    entry({ intervalMs: 10_000, startDelayMs: 0, relogMs: 30_000, run }),
  ]);
  h.svc.load([
    entry({ intervalMs: 10_000, startDelayMs: 0, relogMs: 30_000, run }),
  ]);
  await vi.advanceTimersByTimeAsync(10_000);
  await vi.advanceTimersByTimeAsync(10_000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.sendTo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.sendTo).toHaveBeenCalledTimes(2);
});

it("retries a failed write with the next window and keeps the queue bounded", async () => {
  let fail = true;
  const sendTo = vi.fn(async () => {
    if (fail) throw new Error("down");
    return { success: true };
  });
  let value = 0;
  const h = service(
    [
      entry({
        intervalMs: 1_000,
        startDelayMs: 0,
        relogMs: 0,
        changesOnly: true,
        run: () => ++value,
      }),
    ],
    sendTo,
  );
  h.svc.load([
    entry({
      intervalMs: 1_000,
      startDelayMs: 0,
      relogMs: 0,
      changesOnly: true,
      run: () => ++value,
    }),
  ]);
  for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(1_000);
  expect(h.log.warn).toHaveBeenCalled();
  fail = false;
  await vi.advanceTimersByTimeAsync(1_000);
  const last = sendTo.mock.calls.at(-1)!;
  expect(last[2].state.length).toBeGreaterThan(1);
});

it("keeps points when an older write fails during a newer write", async () => {
  const pending: Array<(error: Error) => void> = [];
  const sendTo = vi.fn((adapter: string, command: string, payload: unknown) => {
    if (adapter !== "history.0" || command !== "storeState") {
      return Promise.reject(new Error("unexpected command"));
    }
    if (pending.length < 2) {
      return new Promise((_resolve, reject) => {
        pending.push(reject);
      });
    }
    return Promise.resolve({ success: true, payload });
  });
  let value = 0;
  const make = () =>
    entry({
      intervalMs: 1_000,
      startDelayMs: 0,
      relogMs: 0,
      run: () => ++value,
    });
  const h = service([make()], sendTo);
  h.svc.load([make()]);
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sendTo).toHaveBeenCalledTimes(2);
  pending[1](new Error("down"));
  await vi.advanceTimersByTimeAsync(0);
  pending[0](new Error("down"));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1_000);
  const last = sendTo.mock.calls.at(-1)!;
  expect(last[2].state.map((point: { ts: number }) => point.ts)).toEqual([
    1_000, 2_000, 3_000,
  ]);
});

it("stops its timers and reports source ids", async () => {
  const h = service([entry(), entry({ id: "0_userdata.0.U" })]);
  h.svc.load([entry(), entry({ id: "0_userdata.0.U", startDelayMs: 2_000 })]);
  expect(h.svc.sourceIds()).toEqual(["0_userdata.0.T", "0_userdata.0.U"]);
  h.svc.stop();
  expect(vi.getTimerCount()).toBe(0);
});
