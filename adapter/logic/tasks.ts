/** Request options accepted from logic code. */
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** What the queue hands to fetch; a test fake implements this shape. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export interface FetchLike {
  (url: string, init: FetchInit): Promise<FetchResponse>;
}

export interface FetchTask {
  url: string;
  options?: FetchOptions;
  /** Scheduling depth + 1: the engine's job depth. */
  depth: number;
  run(data: unknown, error: string | null): void;
}

export interface TaskQueue {
  enqueue(task: FetchTask): void;
  /** The callback job finished; start the next request. */
  done(): void;
  stop(): void;
  /** In flight + waiting; for tests. */
  pending(): number;
}

export const TASK_TIMEOUT_MS = 10_000;
export const TASK_MAX_BODY = 1_000_000;
export const TASK_MAX_WAITING = 10;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeHeaders(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (typeof value === "string") headers[name.toLowerCase()] = value;
  }
  return headers;
}

/**
 * One FIFO queue per logic. The active slot stays taken until the engine calls
 * `done()` after the callback, which is what keeps callbacks ordered.
 */
export function createTaskQueue(
  onSettled: (task: FetchTask, data: unknown, error: string | null) => void,
  log: (message: string) => void,
  fetchImpl?: FetchLike,
): TaskQueue {
  const waiting: FetchTask[] = [];
  let active: { task: FetchTask; controller: AbortController } | undefined;
  let stopped = false;

  async function request(
    task: FetchTask,
    controller: AbortController,
  ): Promise<void> {
    let data: unknown;
    let error: string | null = null;
    const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
    // stop() aborts too; do not leave a 10 s timer behind.
    controller.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
    try {
      if (!fetchImpl) {
        throw new Error("fetch is not available in this Node version");
      }
      const method = (task.options?.method ?? "GET").toUpperCase();
      const headers = normalizeHeaders(task.options?.headers);
      if (!headers.accept) headers.accept = "application/json";
      const body =
        typeof task.options?.body === "string" ? task.options.body : undefined;
      if (body !== undefined && !headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
      const response = await fetchImpl(task.url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        );
      }
      const text = await response.text();
      if (text.length > TASK_MAX_BODY) {
        throw new Error("response too large (> 1 MB)");
      }
      if (text.trim() === "") {
        data = null;
      } else {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          throw new Error(`invalid JSON: ${errorText(parseError)}`);
        }
      }
    } catch (failure) {
      if (stopped) return;
      error = controller.signal.aborted
        ? `timeout after ${TASK_TIMEOUT_MS} ms`
        : errorText(failure);
    } finally {
      clearTimeout(timer);
    }
    if (!stopped) onSettled(task, data, error);
  }

  const pump = (): void => {
    if (stopped || active || waiting.length === 0) return;
    const task = waiting.shift();
    if (!task) return;
    const controller = new AbortController();
    active = { task, controller };
    void request(task, controller);
  };

  return {
    enqueue(task) {
      if (stopped) return;
      if (waiting.length >= TASK_MAX_WAITING) {
        log(`task skipped: queue full (${task.url})`);
        return;
      }
      waiting.push(task);
      pump();
    },
    done() {
      if (stopped) return;
      active = undefined;
      pump();
    },
    stop() {
      stopped = true;
      waiting.length = 0;
      active?.controller.abort();
      active = undefined;
    },
    pending() {
      return (active ? 1 : 0) + waiting.length;
    },
  };
}
