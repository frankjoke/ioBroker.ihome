import { describe, it, expect } from "vitest";
import {
  historyEnabled,
  durationMs,
  stepMs,
  historyKey,
  buildHistoryOptions,
  toSeries,
  type HistorySpec,
} from "$lib/config/history-ops";

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("historyEnabled", () => {
  it("is true when a custom entry is enabled", () => {
    expect(
      historyEnabled({ common: { custom: { "history.0": { enabled: true } } } }),
    ).toBe(true);
  });
  it("is true when a custom entry omits enabled (only false disables)", () => {
    expect(historyEnabled({ common: { custom: { "sql.0": {} } } })).toBe(true);
  });
  it("is false when every custom entry is disabled", () => {
    expect(
      historyEnabled({ common: { custom: { "history.0": { enabled: false } } } }),
    ).toBe(false);
  });
  it("is false without custom or object", () => {
    expect(historyEnabled({ common: {} })).toBe(false);
    expect(historyEnabled(undefined)).toBe(false);
  });
});

describe("durationMs / stepMs", () => {
  it("converts hours and days", () => {
    expect(durationMs({ duration: 24, durationUnit: "hours" })).toBe(24 * HOUR);
    expect(durationMs({ duration: 2, durationUnit: "days" })).toBe(2 * DAY);
  });
  it("converts the step unit and returns undefined when absent", () => {
    expect(
      stepMs({ duration: 1, durationUnit: "hours", step: 30, stepUnit: "minutes" }),
    ).toBe(1_800_000);
    expect(
      stepMs({ duration: 1, durationUnit: "hours", step: 45, stepUnit: "seconds" }),
    ).toBe(45_000);
    expect(stepMs({ duration: 1, durationUnit: "hours" })).toBeUndefined();
  });
});

describe("historyKey", () => {
  it("is stable and changes with the spec", () => {
    const a: HistorySpec = { duration: 24, durationUnit: "hours", count: 200 };
    const b: HistorySpec = { duration: 24, durationUnit: "hours", count: 100 };
    expect(historyKey("s", a)).toBe(historyKey("s", a));
    expect(historyKey("s", a)).not.toBe(historyKey("s", b));
    expect(historyKey("s", a)).not.toBe(historyKey("t", a));
  });
});

describe("buildHistoryOptions", () => {
  const now = 1_000_000_000_000;
  it("uses count when set", () => {
    expect(
      buildHistoryOptions({ duration: 24, durationUnit: "hours", count: 200 }, now),
    ).toEqual({ start: now - 24 * HOUR, end: now, ignoreNull: true, count: 200 });
  });
  it("uses step + aggregate when only step is set", () => {
    expect(
      buildHistoryOptions(
        {
          duration: 2,
          durationUnit: "days",
          step: 30,
          stepUnit: "minutes",
          aggregate: "max",
        },
        now,
      ),
    ).toEqual({
      start: now - 2 * DAY,
      end: now,
      ignoreNull: true,
      step: 1_800_000,
      aggregate: "max",
    });
  });
  it("count wins when both are set", () => {
    expect(
      buildHistoryOptions(
        {
          duration: 1,
          durationUnit: "hours",
          count: 10,
          step: 60,
          stepUnit: "minutes",
          aggregate: "min",
        },
        now,
      ),
    ).toEqual({ start: now - HOUR, end: now, ignoreNull: true, count: 10 });
  });
  it("raw when neither is set", () => {
    expect(buildHistoryOptions({ duration: 1, durationUnit: "hours" }, now)).toEqual(
      { start: now - HOUR, end: now, ignoreNull: true },
    );
  });
});

describe("toSeries", () => {
  it("keeps only finite numeric { ts, val }, sorted and de-duped", () => {
    const res = {
      result: [
        { ts: 2, val: 20, from: "a", ack: true },
        { ts: 1, val: 10 },
        { ts: 3, val: "n/a" },
        { ts: 4, val: null },
        { ts: 2, val: 21, q: 1 },
      ],
    };
    expect(toSeries(res)).toEqual([
      { ts: 1, val: 10 },
      { ts: 2, val: 20 },
    ]);
    expect(toSeries(res)[0]).not.toHaveProperty("from");
  });
  it("returns [] for an empty or malformed response", () => {
    expect(toSeries({ result: [] })).toEqual([]);
    expect(toSeries(undefined)).toEqual([]);
  });
});
