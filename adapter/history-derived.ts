import {
  derivedNumber,
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
  /** Re-check the state/adapter config before a write; null keeps writing. */
  entryProblem?(entry: RuntimeDerivedEntry): Promise<string | null>;
  log: DerivedLogger;
}

/** Node clamps larger setTimeout values to 1 ms; wake up in chunks instead. */
const MAX_TIMER_MS = 2_147_483_647;

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
  gateProblem?: string;
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
}): DerivedSample | null {
  const val = derivedNumber(state.val);
  if (val === null) return null;
  return {
    ts:
      typeof state.ts === "number" && Number.isFinite(state.ts)
        ? state.ts
        : Date.now(),
    val,
    ack: state.ack,
    from: state.from,
    changed: state.changed,
  };
}

function replyProblem(reply: unknown): string {
  if (!reply || typeof reply !== "object") return "";
  const outer = reply as Record<string, unknown>;
  const value =
    outer.result &&
    typeof outer.result === "object" &&
    !Array.isArray(outer.result)
      ? (outer.result as Record<string, unknown>)
      : outer;
  if (typeof value.error === "string" && value.error) return value.error;
  if (value.success === false || value.ok === false) {
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

  /**
   * Apply the document. An entry whose schedule is unchanged keeps its timer,
   * window and last-written value; a function-only edit takes effect at the
   * next boundary instead of discarding the open window.
   */
  load(entries: RuntimeDerivedEntry[]): void {
    const now = this.deps.now();
    const next = new Map<string, RuntimeDerivedEntry>();
    for (const entry of entries) next.set(keyOf(entry), entry);

    for (const [key, state] of [...this.entries]) {
      const entry = next.get(key);
      if (
        !entry ||
        entry.intervalMs !== state.entry.intervalMs ||
        entry.startDelayMs !== state.entry.startDelayMs
      ) {
        state.stopped = true;
        if (state.timer) this.deps.clearTimeout(state.timer);
        this.entries.delete(key);
        continue;
      }
      state.entry = entry;
    }

    for (const entry of next.values()) {
      const key = keyOf(entry);
      if (this.entries.has(key)) continue;
      const state: EntryState = {
        entry,
        nextTo: now + entry.startDelayMs + entry.intervalMs,
        samples: [],
        previous: entry.previous ?? null,
        queue: [],
        stopped: false,
      };
      this.entries.set(key, state);
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
    if (!sample) return;
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
    state.timer = this.deps.setTimeout(
      () => {
        if (this.deps.now() < state.nextTo) {
          this.schedule(state);
          return;
        }
        void this.closeWindow(state);
      },
      Math.min(wait, MAX_TIMER_MS),
    );
  }

  private async closeWindow(state: EntryState): Promise<void> {
    if (state.stopped || this.entries.get(keyOf(state.entry)) !== state) {
      return;
    }
    const entry = state.entry;
    const to = state.nextTo;
    if (this.deps.now() < to) {
      this.schedule(state);
      return;
    }
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
      let problem: string | null = null;
      if (this.deps.entryProblem) {
        try {
          problem = await this.deps.entryProblem(entry);
        } catch {
          // An unreadable object is unknown, not a reason to drop data.
          problem = null;
        }
      }
      if (problem) {
        if (state.gateProblem !== problem) {
          this.deps.log.warn(
            `derived ${entry.id}/${entry.adapter}: ${problem}`,
          );
        }
        state.gateProblem = problem;
        state.queue = [];
        return;
      }
      const resumed = state.gateProblem !== undefined;
      state.gateProblem = undefined;
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
        if (resumed) {
          this.deps.log.info(
            `derived ${entry.id}/${entry.adapter}: writing again`,
          );
        }
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
      // At least once: a timeout after the adapter stored the point may
      // retry it, because storeState has no idempotency key.
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
      // A newer flush may have succeeded while this one was in flight; an
      // older timestamp must not move the relog clock backwards.
      const last = points[points.length - 1];
      if (state.lastWrittenTs === undefined || last.ts >= state.lastWrittenTs) {
        state.lastWritten = last.val;
        state.lastWrittenTs = last.ts;
      }
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
