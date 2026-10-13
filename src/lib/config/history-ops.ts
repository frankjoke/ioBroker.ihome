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
