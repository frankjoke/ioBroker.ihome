import {
  MAX_DERIVED_QUEUE,
  shouldWrite,
  type DerivedPoint,
} from "./history-derived-common";
import {
  NOOP,
  type DerivedContext,
  type DerivedSample,
} from "./history-derived-runtime";

export interface RuntimeDerivedEntry {
  id: string;
  adapter: string;
  intervalMs: number;
  startDelayMs: number;
  changesOnly: boolean;
  relogMs: number;
  run: (context: DerivedContext) => unknown;
  /** Last state before the first window, when the adapter warmed it. */
  previous?: DerivedSample | null;
}

export interface DerivedLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface DerivedServiceDeps {
  namespace: string;
  now(): number;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  sendTo(adapter: string, command: string, payload: unknown): Promise<unknown>;
  log: DerivedLogger;
}

interface EntryState {
  entry: RuntimeDerivedEntry;
  nextTo: number;
  timer?: ReturnType<typeof setTimeout>;
  samples: DerivedSample[];
  previous: DerivedSample | null;
  lastWritten?: number;
  lastWrittenTs?: number;
  queue: DerivedPoint[];
  stopped: boolean;
}

function keyOf(entry: RuntimeDerivedEntry): string {
  return `${entry.adapter}\u0000${entry.id}`;
}

function sampleOf(state: {
  val: unknown;
  ts?: number;
  ack?: boolean;
  from?: string;
  changed?: boolean;
  lc?: number;
}): DerivedSample {
  return {
    ts:
      typeof state.ts === "number" && Number.isFinite(state.ts)
        ? state.ts
        : Date.now(),
    val: state.val,
    ack: state.ack,
    from: state.from,
    changed: state.changed,
  };
}

function replyProblem(reply: unknown): string {
  if (!reply || typeof reply !== "object") return "";
  const value = reply as Record<string, unknown>;
  if (typeof value.error === "string" && value.error) return value.error;
  if (value.success === false) {
    return typeof value.message === "string"
      ? value.message
      : "storeState was rejected";
  }
  return "";
}

/**
 * One timer, window and retry queue per derived entry. The service never
 * reads or writes the source state itself; the adapter feeds it changes.
 */
export class DerivedHistoryService {
  private readonly entries = new Map<string, EntryState>();
  private readonly deps: DerivedServiceDeps;

  constructor(deps: DerivedServiceDeps) {
    this.deps = deps;
  }

  /** Replace every entry and re-anchor from now. */
  load(entries: RuntimeDerivedEntry[]): void {
    this.stop();
    const now = this.deps.now();
    for (const entry of entries) {
      const state: EntryState = {
        entry,
        nextTo: now + entry.startDelayMs + entry.intervalMs,
        samples: [],
        previous: entry.previous ?? null,
        queue: [],
        stopped: false,
      };
      this.entries.set(keyOf(entry), state);
      this.schedule(state);
    }
  }

  stop(): void {
    for (const state of this.entries.values()) {
      state.stopped = true;
      if (state.timer) this.deps.clearTimeout(state.timer);
    }
    this.entries.clear();
  }

  sourceIds(): string[] {
    return [
      ...new Set([...this.entries.values()].map((state) => state.entry.id)),
    ];
  }

  /** Feed one broker change. It is sampled only for matching entries. */
  onStateChange(
    id: string,
    state: {
      val: unknown;
      ts?: number;
      ack?: boolean;
      from?: string;
      changed?: boolean;
    },
  ): void {
    const sample = sampleOf(state);
    for (const entry of this.entries.values()) {
      if (entry.entry.id !== id) continue;
      const from = entry.nextTo - entry.entry.intervalMs;
      if (sample.ts < from) {
        entry.previous = sample;
        continue;
      }
      entry.samples.push(sample);
      entry.samples.sort((left, right) => left.ts - right.ts);
    }
  }

  private schedule(state: EntryState): void {
    if (state.stopped) return;
    const wait = Math.max(0, state.nextTo - this.deps.now());
    state.timer = this.deps.setTimeout(() => {
      void this.closeWindow(state);
    }, wait);
  }

  private async closeWindow(state: EntryState): Promise<void> {
    if (state.stopped || this.entries.get(keyOf(state.entry)) !== state) {
      return;
    }
    const entry = state.entry;
    const to = state.nextTo;
    const from = to - entry.intervalMs;
    const samples = state.samples.filter(
      (sample) => sample.ts >= from && sample.ts < to,
    );
    state.samples = state.samples.filter((sample) => sample.ts >= to);
    const previous = state.previous;
    const lastBefore = samples.length ? samples[samples.length - 1] : previous;
    state.previous = lastBefore;

    let value: unknown = NOOP;
    try {
      value = entry.run({ samples, previous, from, to });
    } catch (error) {
      this.deps.log.error(
        `derived ${entry.id}/${entry.adapter}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      value = NOOP;
    }

    const now = this.deps.now();
    const nextTo = to + entry.intervalMs;
    if (now > nextTo + entry.intervalMs) {
      const skipped = Math.floor((now - nextTo) / entry.intervalMs) + 1;
      state.nextTo = nextTo + skipped * entry.intervalMs;
      state.samples = state.samples.filter(
        (sample) => sample.ts >= state.nextTo - entry.intervalMs,
      );
    } else {
      state.nextTo = nextTo;
    }
    this.schedule(state);

    if (value !== NOOP && typeof value === "number" && Number.isFinite(value)) {
      if (
        shouldWrite({
          value,
          lastWritten: state.lastWritten,
          lastWrittenTs: state.lastWrittenTs,
          to,
          changesOnly: entry.changesOnly,
          relogMs: entry.relogMs,
        })
      ) {
        state.queue.push({ ts: to, val: value });
        if (state.queue.length > MAX_DERIVED_QUEUE) {
          const dropped = state.queue.length - MAX_DERIVED_QUEUE;
          state.queue = state.queue.slice(-MAX_DERIVED_QUEUE);
          this.deps.log.warn(
            `derived ${entry.id}/${entry.adapter}: dropped ${dropped} queued point(s)`,
          );
        }
      }
    } else if (value !== NOOP && value !== undefined) {
      this.deps.log.error(
        `derived ${entry.id}/${entry.adapter}: function must return a finite number or NOOP`,
      );
    }

    await this.flush(state);
  }

  private async flush(state: EntryState): Promise<void> {
    if (state.stopped || !state.queue.length) return;
    const points = state.queue;
    // New points can arrive while storeState is in flight; only this snapshot
    // is cleared after a successful send.
    state.queue = [];
    try {
      const reply = await this.deps.sendTo(state.entry.adapter, "storeState", {
        id: state.entry.id,
        state: points.map((point) => ({
          ts: point.ts,
          val: point.val,
          ack: true,
          from: this.deps.namespace,
        })),
      });
      const problem = replyProblem(reply);
      if (problem) throw new Error(problem);
      const last = points[points.length - 1];
      state.lastWritten = last.val;
      state.lastWrittenTs = last.ts;
    } catch (error) {
      state.queue = [...points, ...state.queue];
      if (state.queue.length > MAX_DERIVED_QUEUE) {
        const dropped = state.queue.length - MAX_DERIVED_QUEUE;
        state.queue = state.queue.slice(-MAX_DERIVED_QUEUE);
        this.deps.log.warn(
          `derived ${state.entry.id}/${state.entry.adapter}: dropped ${dropped} queued point(s)`,
        );
      }
      this.deps.log.warn(
        `derived ${state.entry.id}/${state.entry.adapter}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
