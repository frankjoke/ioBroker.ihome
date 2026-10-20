import { describe, it, expect } from "vitest";
import {
  historyEnabled,
  durationMs,
  stepMs,
  historyKey,
  buildHistoryOptions,
  toSeries,
  summarize,
  trimSeries,
  appendLive,
  sparklinePoints,
  seriesPoints,
  durationLabel,
  granularityLabel,
} from "$lib/config/history-ops";
import type { HistorySpec } from "$lib/types/device";

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("historyEnabled", () => {
  it("is true when a custom entry is enabled", () => {
    expect(
      historyEnabled({
        common: { custom: { "history.0": { enabled: true } } },
      }),
    ).toBe(true);
  });
  it("is true when a custom entry omits enabled (only false disables)", () => {
    expect(historyEnabled({ common: { custom: { "sql.0": {} } } })).toBe(true);
  });
  it("is false when every custom entry is disabled", () => {
    expect(
      historyEnabled({
        common: { custom: { "history.0": { enabled: false } } },
      }),
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
      stepMs({
        duration: 1,
        durationUnit: "hours",
        step: 30,
        stepUnit: "minutes",
      }),
    ).toBe(1_800_000);
    expect(
      stepMs({
        duration: 1,
        durationUnit: "hours",
        step: 45,
        stepUnit: "seconds",
      }),
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
      buildHistoryOptions(
        { duration: 24, durationUnit: "hours", count: 200 },
        now,
      ),
    ).toEqual({
      start: now - 24 * HOUR,
      end: now,
      ignoreNull: true,
      count: 200,
    });
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
    expect(
      buildHistoryOptions({ duration: 1, durationUnit: "hours" }, now),
    ).toEqual({ start: now - HOUR, end: now, ignoreNull: true });
  });
});

describe("toSeries", () => {
  it("accepts the socket's bare array response (err, rows, step, sessionId)", () => {
    expect(
      toSeries([
        { ts: 2, val: 20, ack: true, from: "x" },
        { ts: 1, val: 10 },
      ]),
    ).toEqual([
      { ts: 1, val: 10 },
      { ts: 2, val: 20 },
    ]);
  });

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
    expect(toSeries([])).toEqual([]);
    expect(toSeries(undefined)).toEqual([]);
    expect(toSeries(null)).toEqual([]);
  });
});

describe("summarize", () => {
  it("counts and finds min/max", () => {
    expect(
      summarize([
        { ts: 1, val: 10 },
        { ts: 2, val: 30 },
      ]),
    ).toEqual({
      count: 2,
      min: 10,
      max: 30,
    });
  });
  it("handles an empty series", () => {
    expect(summarize([])).toEqual({ count: 0, min: undefined, max: undefined });
  });
});

describe("trimSeries", () => {
  const now = 100_000;
  const series = [
    { ts: now - 10_000, val: 1 },
    { ts: now - 1_000, val: 2 },
    { ts: now, val: 3 },
  ];
  it("drops points older than the window", () => {
    expect(trimSeries(series, { windowMs: 5_000, now })).toEqual([
      { ts: now - 1_000, val: 2 },
      { ts: now, val: 3 },
    ]);
  });
  it("returns the input array unchanged when nothing is dropped", () => {
    expect(trimSeries(series, { windowMs: 60_000, now })).toBe(series);
  });
  it("caps to the newest `max` points when given", () => {
    expect(trimSeries(series, { windowMs: 60_000, max: 1, now })).toEqual([
      { ts: now, val: 3 },
    ]);
  });
});

describe("appendLive", () => {
  const spec: HistorySpec = { duration: 1, durationUnit: "hours" };
  const now = 100_000;
  it("appends a strictly newer point", () => {
    expect(
      appendLive([{ ts: 99_000, val: 1 }], { ts: 100_000, val: 2 }, spec, now),
    ).toEqual([
      { ts: 99_000, val: 1 },
      { ts: 100_000, val: 2 },
    ]);
  });
  it("returns the same array for an older or equal point", () => {
    const s = [{ ts: 100_000, val: 1 }];
    expect(appendLive(s, { ts: 100_000, val: 9 }, spec, now)).toBe(s);
    expect(appendLive(s, { ts: 90_000, val: 9 }, spec, now)).toBe(s);
  });
  it("trims to the window while appending", () => {
    const s = [{ ts: now - 2 * 3_600_000, val: 1 }];
    expect(appendLive(s, { ts: now, val: 2 }, spec, now)).toEqual([
      { ts: now, val: 2 },
    ]);
  });
  it("does not evict fetched points because of a sample count", () => {
    const counted: HistorySpec = {
      duration: 1,
      durationUnit: "hours",
      count: 2,
    };
    const base = [
      { ts: 1_000, val: 1 },
      { ts: 2_000, val: 2 },
    ];
    expect(appendLive(base, { ts: 3_000, val: 3 }, counted, 3_000)).toEqual([
      { ts: 1_000, val: 1 },
      { ts: 2_000, val: 2 },
      { ts: 3_000, val: 3 },
    ]);
  });
});

describe("sparklinePoints", () => {
  it("is empty for no points", () => {
    expect(sparklinePoints([], 100, 20)).toBe("");
  });
  it("draws a flat mid-line for one point or a flat series", () => {
    expect(sparklinePoints([{ ts: 1, val: 5 }], 100, 20, 0)).toBe(
      "0,10 100,10",
    );
    expect(
      sparklinePoints(
        [
          { ts: 0, val: 5 },
          { ts: 10, val: 5 },
        ],
        100,
        20,
        0,
      ),
    ).toBe("0,10 100,10");
  });
  it("maps time to x and value to y (inverted)", () => {
    expect(
      sparklinePoints(
        [
          { ts: 0, val: 0 },
          { ts: 10, val: 10 },
        ],
        100,
        20,
        0,
      ),
    ).toBe("0,20 100,0");
  });
});

describe("seriesPoints (A61)", () => {
  const opts = { from: 0, to: 1000, width: 100, height: 20 };
  it("places points by timestamp across a shared window", () => {
    expect(
      seriesPoints(
        [
          { ts: 0, val: 0 },
          { ts: 1000, val: 10 },
        ],
        opts,
      ),
    ).toBe("0,20 100,0");
  });
  it("keeps a shorter series in the right-hand part of the window", () => {
    expect(
      seriesPoints(
        [
          { ts: 500, val: 0 },
          { ts: 1000, val: 10 },
        ],
        opts,
      ),
    ).toBe("50,20 100,0");
  });
  it("clamps an out-of-window sample to the edge", () => {
    expect(
      seriesPoints(
        [
          { ts: -500, val: 0 },
          { ts: 1000, val: 10 },
        ],
        opts,
      ),
    ).toBe("0,20 100,0");
  });
  it("draws the flat centre line for one point or a constant series", () => {
    expect(seriesPoints([{ ts: 1, val: 5 }], opts)).toBe("0,10 100,10");
    expect(
      seriesPoints(
        [
          { ts: 0, val: 5 },
          { ts: 1000, val: 5 },
        ],
        opts,
      ),
    ).toBe("0,10 100,10");
  });
  it("is empty for no points and falls back to index spacing on a degenerate window", () => {
    expect(seriesPoints([], opts)).toBe("");
    expect(
      seriesPoints(
        [
          { ts: 5, val: 0 },
          { ts: 5, val: 10 },
        ],
        { ...opts, from: 5, to: 5 },
      ),
    ).toBe("0,20 100,0");
  });
});

describe("labels", () => {
  it("describes the duration", () => {
    expect(durationLabel({ duration: 24, durationUnit: "hours" })).toBe(
      "last 24h",
    );
    expect(durationLabel({ duration: 7, durationUnit: "days" })).toBe(
      "last 7d",
    );
  });
  it("describes the granularity", () => {
    expect(
      granularityLabel({ duration: 24, durationUnit: "hours", count: 200 }),
    ).toBe("200 samples");
    expect(
      granularityLabel({
        duration: 1,
        durationUnit: "hours",
        step: 30,
        stepUnit: "minutes",
        aggregate: "max",
      }),
    ).toBe("30min max");
    expect(granularityLabel({ duration: 1, durationUnit: "hours" })).toBe(
      "raw",
    );
  });
});
