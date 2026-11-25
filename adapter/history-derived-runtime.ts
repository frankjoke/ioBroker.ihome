import { createContext, runInContext, Script } from "node:vm";

export interface DerivedSample {
  ts: number;
  val: unknown;
  ack?: boolean;
  from?: string;
  changed?: boolean;
}

export interface DerivedContext {
  samples: DerivedSample[];
  previous: DerivedSample | null;
  from: number;
  to: number;
}

/** The module-private "no write" sentinel. */
export const NOOP = Symbol("NOOP");

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function mean(values: unknown[]): number {
  const numbers = values.filter(numeric);
  return numbers.length
    ? numbers.reduce((total, value) => total + value, 0) / numbers.length
    : NaN;
}

export function sum(values: unknown[]): number {
  return values.filter(numeric).reduce((total, value) => total + value, 0);
}

export function min(values: unknown[]): number {
  const numbers = values.filter(numeric);
  return numbers.length ? Math.min(...numbers) : NaN;
}

export function max(values: unknown[]): number {
  const numbers = values.filter(numeric);
  return numbers.length ? Math.max(...numbers) : NaN;
}

export function median(values: unknown[]): number {
  const numbers = values.filter(numeric).sort((left, right) => left - right);
  if (!numbers.length) return NaN;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
}

/** Exact time-weighted average over [from, to); previous fills the first gap. */
export function timeWeightedMean(
  samples: DerivedSample[],
  from: number,
  to: number,
  previous: DerivedSample | null,
): number {
  if (!(to > from)) return NaN;
  const points = (samples ?? [])
    .filter((sample) => numeric(sample.val))
    .map((sample) => ({ ts: sample.ts, val: sample.val as number }))
    .filter((sample) => sample.ts < to)
    .sort((left, right) => left.ts - right.ts);
  const previousValue = previous && numeric(previous.val) ? previous.val : null;
  if (!points.length) return previousValue === null ? NaN : previousValue;

  let total = 0;
  let start = from;
  let cursor = from;
  if (previousValue !== null) {
    const first = Math.min(points[0].ts, to);
    if (first > from) {
      total += previousValue * (first - from);
      cursor = first;
    }
  } else {
    start = Math.max(from, Math.min(points[0].ts, to));
    cursor = start;
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const pointStart = Math.max(cursor, point.ts, from);
    if (pointStart >= to) break;
    const next =
      index + 1 < points.length ? Math.min(points[index + 1].ts, to) : to;
    if (next > pointStart) total += point.val * (next - pointStart);
    cursor = Math.max(cursor, next);
  }
  return cursor > start ? total / (to - start) : NaN;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compile once; run in a fresh context per interval. The function sees only
 * the window and the helper set, never the broker or the process.
 */
export function compileDerivedFunction(
  code: string,
): (context: DerivedContext) => unknown {
  let script: Script;
  try {
    script = new Script(`(function () {\n${code}\n}).call(undefined)`, {
      filename: "derived-history",
    });
  } catch (error) {
    throw new Error(`derived function failed to compile: ${errorText(error)}`);
  }
  return (context) => {
    const sandbox: Record<string, unknown> = Object.create(null);
    Object.assign(sandbox, {
      samples: context.samples,
      previous: context.previous,
      from: context.from,
      to: context.to,
      mean,
      timeWeightedMean,
      median,
      sum,
      min,
      max,
      NOOP,
    });
    const vm = createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    // Node injects a console into every context; the function API has none.
    runInContext("delete globalThis.console", vm);
    const result = script.runInContext(vm, { timeout: 100 });
    if (result === NOOP) return NOOP;
    if (!numeric(result)) {
      throw new Error("derived function must return a finite number or NOOP");
    }
    return result;
  };
}
