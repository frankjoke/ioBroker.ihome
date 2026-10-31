import type { Engine, EngineDeps, StateChange } from "./engine";

/** A manual clock: timers fire only when the test advances it. */
export class FakeClock {
  now = 0;
  #timers = new Map<number, { at: number; fn: () => void }>();
  #next = 1;

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.#timers.delete(id);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = target;
  }
}

export interface Write {
  id: string;
  value: unknown;
  ack: boolean;
}

export interface LogLine {
  level: string;
  logicId: string;
  message: string;
}

export interface Harness {
  deps: EngineDeps;
  clock: FakeClock;
  writes: Write[];
  logs: LogLine[];
  attach(engine: Engine): void;
  change(
    id: string,
    val: unknown,
    extra?: { ack?: boolean; from?: string },
  ): void;
}

/**
 * A fake broker for engine tests: values by state id, recorded writes and
 * logs, and a clock the test advances. `attach` is how `change` reaches the
 * engine it belongs to.
 */
export function createHarness(values: Record<string, unknown>): Harness {
  const clock = new FakeClock();
  const writes: Write[] = [];
  const logs: LogLine[] = [];
  let engine: Engine | undefined;

  const deps: EngineDeps = {
    read: (id) => values[id],
    write: (id, value, ack) => {
      values[id] = value; // like the broker: a write changes the current value
      writes.push({ id, value, ack });
    },
    log: (level, logicId, message) => logs.push({ level, logicId, message }),
    now: () => clock.now,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (handle) => clock.clearTimeout(handle),
  };

  return {
    deps,
    clock,
    writes,
    logs,
    attach(next) {
      engine = next;
    },
    change(id, val, extra = {}) {
      values[id] = val;
      const change: StateChange = { id, val, ...extra };
      engine?.onStateChange(change);
    },
  };
}
