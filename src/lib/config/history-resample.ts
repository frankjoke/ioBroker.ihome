export type ResampleAggregate = "average" | "min" | "max" | "last";

export interface HistoryLikeRow {
  ts: number;
  val: unknown;
}

export interface ResamplePoint {
  ts: number;
  val: number;
}

/**
 * Reduce raw history rows to one numeric point per bucket. The point keeps the
 * bucket's start timestamp; non-numeric and non-finite values are skipped.
 */
export function resamplePoints(
  rows: HistoryLikeRow[],
  stepMs: number,
  aggregate: ResampleAggregate = "average",
): ResamplePoint[] {
  if (!Number.isFinite(stepMs) || stepMs <= 0) return [];
  const buckets = new Map<
    number,
    {
      sum: number;
      count: number;
      min: number;
      max: number;
      last: number;
      lastTs: number;
    }
  >();
  for (const row of rows ?? []) {
    if (
      !Number.isFinite(row.ts) ||
      typeof row.val !== "number" ||
      !Number.isFinite(row.val)
    ) {
      continue;
    }
    const ts = Math.floor(row.ts / stepMs) * stepMs;
    const bucket = buckets.get(ts);
    if (!bucket) {
      buckets.set(ts, {
        sum: row.val,
        count: 1,
        min: row.val,
        max: row.val,
        last: row.val,
        lastTs: row.ts,
      });
      continue;
    }
    bucket.sum += row.val;
    bucket.count += 1;
    bucket.min = Math.min(bucket.min, row.val);
    bucket.max = Math.max(bucket.max, row.val);
    if (row.ts >= bucket.lastTs) {
      bucket.last = row.val;
      bucket.lastTs = row.ts;
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, bucket]) => ({
      ts,
      val:
        aggregate === "min"
          ? bucket.min
          : aggregate === "max"
            ? bucket.max
            : aggregate === "last"
              ? bucket.last
              : bucket.sum / bucket.count,
    }));
}

/** CSV with an ISO timestamp and a value column; null becomes an empty cell. */
export function csvText(rows: HistoryLikeRow[]): string {
  const value = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return `"${v.replaceAll('"', '""')}"`;
    return `"${JSON.stringify(v).replaceAll('"', '""')}"`;
  };
  return (
    [
      "timestamp,value",
      ...rows.map(
        (row) => `${new Date(row.ts).toISOString()},${value(row.val)}`,
      ),
    ].join("\n") + "\n"
  );
}
