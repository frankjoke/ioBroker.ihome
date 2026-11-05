export interface LogLine {
  seq: number;
  ts: number;
  from: string;
  severity: string;
  message: string;
  /** Message toasts: seconds until dismissal; 0 keeps it until closed. */
  timeout?: number;
}

export interface LogRaw {
  ts?: number;
  from?: string;
  severity?: string;
  message?: string;
  timeout?: number;
}

export interface LogPage {
  seq: number;
  entries: LogLine[];
}

/**
 * A bounded, sequence-numbered ring of the broker's log lines. The adapter
 * feeds it from `adapter.on("log")`; the SPA pages it with `since` so a poll
 * only carries what is new.
 */
export function createLogBuffer(max = 1000) {
  const entries: LogLine[] = [];
  let seq = 0;
  const size = Math.max(1, max);
  return {
    push(raw: LogRaw): void {
      seq += 1;
      entries.push({
        seq,
        ts: Number(raw.ts) || 0,
        from: String(raw.from ?? ""),
        severity: String(raw.severity ?? "info"),
        message: String(raw.message ?? ""),
        timeout: raw.timeout === undefined ? undefined : Number(raw.timeout),
      });
      if (entries.length > size) entries.splice(0, entries.length - size);
    },
    /** Lines after `since`, capped to the newest `limit`. */
    slice(since: number, limit = 500): LogPage {
      const fresh = entries.filter((entry) => entry.seq > since);
      return { seq, entries: fresh.slice(-Math.max(1, limit)) };
    },
    clear(): void {
      entries.length = 0;
    },
  };
}

export type LogBuffer = ReturnType<typeof createLogBuffer>;
