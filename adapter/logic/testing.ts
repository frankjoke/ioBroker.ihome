import type { Engine, EngineDeps, LogicReading, StateChange } from "./engine";
import type { FetchInit, FetchLike } from "./tasks";

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

  /** Timers still armed; used to prove a state really cancelled its own. */
  get pending(): number {
    return this.#timers.size;
  }

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

export interface MessageLine extends LogLine {
  timeout?: number;
}

export interface NotificationLine {
  level: string;
  logicId: string;
  title: string;
  body: string;
}

export interface FetchRequest {
  url: string;
  init: FetchInit;
  respond(response?: {
    status?: number;
    statusText?: string;
    body?: string;
  }): void;
  fail(error: unknown): void;
}

export interface Harness {
  deps: EngineDeps;
  clock: FakeClock;
  writes: Write[];
  logs: LogLine[];
  messages: MessageLine[];
  notifications: NotificationLine[];
  reports: Array<{ logicId: string; reading: LogicReading }>;
  requests: FetchRequest[];
  /** The first request that has neither responded nor failed. */
  nextRequest(): FetchRequest | undefined;
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
  const messages: MessageLine[] = [];
  const notifications: NotificationLine[] = [];
  const reports: Array<{ logicId: string; reading: LogicReading }> = [];
  const requests: Array<FetchRequest & { pending: boolean }> = [];
  let engine: Engine | undefined;

  const fetch: FetchLike = (url, init) =>
    new Promise((resolve, reject) => {
      const request: FetchRequest & { pending: boolean } = {
        url,
        init,
        pending: true,
        respond(response: {
          status?: number;
          statusText?: string;
          body?: string;
        } = {}) {
          if (!request.pending) return;
          request.pending = false;
          const status = response.status ?? 200;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusText ?? "",
            text: async () => response.body ?? "",
          });
        },
        fail(error: unknown) {
          if (!request.pending) return;
          request.pending = false;
          reject(error);
        },
      };
      init.signal.addEventListener("abort", () =>
        request.fail(new Error("aborted")),
      );
      requests.push(request);
    });

  const deps: EngineDeps = {
    read: (id) => values[id],
    write: (id, value, ack) => {
      values[id] = value; // like the broker: a write changes the current value
      writes.push({ id, value, ack });
    },
    log: (level, logicId, message) => logs.push({ level, logicId, message }),
    message: (level, logicId, message, timeout) =>
      messages.push({ level, logicId, message, timeout }),
    notify: (level, logicId, title, body) =>
      notifications.push({ level, logicId, title, body }),
    now: () => clock.now,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (handle) => clock.clearTimeout(handle),
    fetch,
    report: (logicId, reading) => reports.push({ logicId, reading }),
  };

  return {
    deps,
    clock,
    writes,
    logs,
    messages,
    notifications,
    reports,
    requests,
    nextRequest: () => requests.find((request) => request.pending),
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
