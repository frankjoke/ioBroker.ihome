import type { HistorySpec } from "$lib/types/device";

/** A single reduced history sample — timestamp + value only. */
export interface HistoryPoint {
  ts: number;
  val: number;
}

/**
 * Whether a state object has history attached: at least one `common.custom`
 * entry that is not explicitly disabled.
 */
export function historyEnabled(obj: any): boolean {
  return Object.values(obj?.common?.custom ?? {}).some(
    (e: any) => e?.enabled !== false,
  );
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The backwards window in milliseconds. */
export function durationMs(spec: HistorySpec): number {
  return spec.duration * (spec.durationUnit === "days" ? DAY_MS : HOUR_MS);
}

/** The aggregation bucket size in milliseconds, or undefined when unset. */
export function stepMs(spec: HistorySpec): number | undefined {
  if (!spec.step) return undefined;
  const unit = spec.stepUnit ?? "minutes";
  const scale =
    unit === "seconds" ? 1_000 : unit === "hours" ? HOUR_MS : 60_000;
  return spec.step * scale;
}

/** A stable cache key for a state + spec pair. */
export function historyKey(stateId: string, spec: HistorySpec): string {
  return `${stateId}|${spec.duration}${spec.durationUnit}|${spec.count ?? ""}|${
    spec.step ?? ""
  }${spec.stepUnit ?? ""}|${spec.aggregate ?? ""}`;
}

/** Build the ioBroker `getHistory` options. `count` wins over `step`. */
export function buildHistoryOptions(
  spec: HistorySpec,
  now: number = Date.now(),
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    start: now - durationMs(spec),
    end: now,
    ignoreNull: true,
  };
  if (spec.count) {
    options.count = spec.count;
  } else {
    const step = stepMs(spec);
    if (step) {
      options.step = step;
      options.aggregate = spec.aggregate ?? "average";
    }
  }
  return options;
}

/** Reduce a `getHistory` response to sorted, de-duped `{ ts, val }` pairs. */
export function toSeries(result: any): HistoryPoint[] {
  const rows = Array.isArray(result?.result) ? result.result : [];
  const points: HistoryPoint[] = [];
  for (const r of rows) {
    const ts = r?.ts;
    const val = r?.val;
    if (typeof ts !== "number" || typeof val !== "number") continue;
    if (!Number.isFinite(val)) continue;
    points.push({ ts, val });
  }
  points.sort((a, b) => a.ts - b.ts);
  return points.filter((p, i) => i === 0 || p.ts !== points[i - 1].ts);
}

/** Count and numeric range of a series. */
export function summarize(series: HistoryPoint[]): {
  count: number;
  min?: number;
  max?: number;
} {
  if (!series.length) return { count: 0, min: undefined, max: undefined };
  let min = series[0].val;
  let max = series[0].val;
  for (const p of series) {
    if (p.val < min) min = p.val;
    if (p.val > max) max = p.val;
  }
  return { count: series.length, min, max };
}

/**
 * Drop points outside the window, then cap to the newest `max` points when
 * given. Returns the input array unchanged when nothing is dropped.
 */
export function trimSeries(
  series: HistoryPoint[],
  opts: { windowMs: number; now: number; max?: number },
): HistoryPoint[] {
  const cutoff = opts.now - opts.windowMs;
  let start = 0;
  while (start < series.length && series[start].ts < cutoff) start++;
  const end = series.length;
  if (opts.max && end - start > opts.max) start = end - opts.max;
  if (start === 0 && end === series.length) return series;
  return series.slice(start, end);
}

// ponytail: hard cap keeps the sparkline cheap; the window (not `count`)
// bounds the visible span, so the "last Nh" label stays honest.
const MAX_LIVE_POINTS = 2000;

/**
 * Append a live point to a fetched series when it is strictly newer, keeping
 * the window trimmed. Returns the same array when nothing changed.
 */
export function appendLive(
  series: HistoryPoint[],
  point: HistoryPoint,
  spec: HistorySpec,
  now: number,
): HistoryPoint[] {
  const last = series[series.length - 1];
  if (last && point.ts <= last.ts) return series;
  return trimSeries([...series, point], {
    windowMs: durationMs(spec),
    now,
    max: MAX_LIVE_POINTS,
  });
}

/** SVG polyline `points` for a series, y inverted; empty string for no points. */
export function sparklinePoints(
  series: HistoryPoint[],
  width: number,
  height: number,
  pad = 0,
): string {
  if (!series.length) return "";
  const flat = `${pad},${height / 2} ${width - pad},${height / 2}`;
  if (series.length === 1) return flat;
  const min = Math.min(...series.map((p) => p.val));
  const max = Math.max(...series.map((p) => p.val));
  if (max === min) return flat;
  const span = max - min;
  const n = series.length;
  return series
    .map((p, i) => {
      const x = pad + (i / (n - 1)) * (width - 2 * pad);
      const y = height - pad - ((p.val - min) / span) * (height - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
}

/** "last 24h" / "last 7d". */
export function durationLabel(spec: HistorySpec): string {
  return `last ${spec.duration}${spec.durationUnit === "days" ? "d" : "h"}`;
}

/** "200 samples" / "30min max" / "raw". */
export function granularityLabel(spec: HistorySpec): string {
  if (spec.count) return `${spec.count} samples`;
  if (spec.step) {
    const unit =
      spec.stepUnit === "seconds"
        ? "s"
        : spec.stepUnit === "hours"
          ? "h"
          : "min";
    return `${spec.step}${unit} ${spec.aggregate ?? "average"}`;
  }
  return "raw";
}
