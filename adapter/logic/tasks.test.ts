import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTaskQueue,
  type FetchLike,
  type FetchResponse,
  type FetchTask,
} from "./tasks";

const task = (url: string): FetchTask => ({ url, depth: 1, run: () => {} });

const response = (
  body = "",
  init: { status?: number; statusText?: string } = {},
): FetchResponse => {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    text: async () => body,
  };
};

/** Let every pending promise callback run. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

afterEach(() => vi.useRealTimers());

describe("createTaskQueue", () => {
  it("fetches JSON with the default accept header", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async (url, init) => {
        calls.push({ url, init });
        return response('{"v":1}');
      },
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(calls[0].url).toBe("https://api.test/x");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toEqual({ accept: "application/json" });
    expect(calls[0].init.body).toBeUndefined();
    expect(settled).toEqual([
      [expect.objectContaining({ url: "https://api.test/x" }), { v: 1 }, null],
    ]);
  });

  it("sends custom headers, method and body", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const queue = createTaskQueue(
      () => {},
      () => {},
      async (url, init) => {
        calls.push({ url, init });
        return response("{}");
      },
    );

    queue.enqueue({
      ...task("https://api.test/x"),
      options: {
        method: "post",
        headers: { "X-Key": "secret", "Content-Type": "text/plain" },
        body: "raw",
      },
    });
    await flush();

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      "x-key": "secret",
      "content-type": "text/plain",
      accept: "application/json",
    });
    expect(calls[0].init.body).toBe("raw");
  });

  it("adds content-type json when a body has none", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const queue = createTaskQueue(
      () => {},
      () => {},
      async (url, init) => {
        calls.push({ url, init });
        return response("{}");
      },
    );

    queue.enqueue({
      ...task("https://api.test/x"),
      options: { method: "POST", body: "{}" },
    });
    await flush();

    expect(calls[0].init.headers["content-type"]).toBe("application/json");
  });

  it("reports a non-2xx status as HTTP <status>", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async () => response("nope", { status: 404, statusText: "Not Found" }),
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(settled[0][1]).toBeUndefined();
    expect(settled[0][2]).toBe("HTTP 404 Not Found");
  });

  it("reports a network rejection", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async () => {
        throw new Error("boom");
      },
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(settled[0][2]).toBe("boom");
  });

  it("reports invalid JSON", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async () => response("{"),
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(String(settled[0][2])).toMatch(/^invalid JSON:/);
  });

  it("turns an empty body into null", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async () => response(" \n"),
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(settled[0][1]).toBeNull();
    expect(settled[0][2]).toBeNull();
  });

  it("rejects a body over 1 MB before parsing", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      async () => response("x".repeat(1_000_001)),
    );

    queue.enqueue(task("https://api.test/x"));
    await flush();

    expect(settled[0][2]).toBe("response too large (> 1 MB)");
  });

  it("times out after 10 s", async () => {
    vi.useFakeTimers();
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    queue.enqueue(task("https://api.test/slow"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled[0][2]).toBe("timeout after 10000 ms");
  });

  it("runs one request at a time and waits for done()", async () => {
    const calls: string[] = [];
    const resolvers: Array<(value: FetchResponse) => void> = [];
    const settled: string[] = [];
    const queue = createTaskQueue(
      (finished) => settled.push(finished.url),
      () => {},
      (url) =>
        new Promise((resolve) => {
          calls.push(url);
          resolvers.push(resolve);
        }),
    );

    queue.enqueue(task("a"));
    queue.enqueue(task("b"));
    await flush();

    expect(calls).toEqual(["a"]);
    resolvers[0](response("{}"));
    await flush();
    expect(settled).toEqual(["a"]);
    expect(calls).toEqual(["a"]); // still the same task slot

    queue.done();
    await flush();
    expect(calls).toEqual(["a", "b"]);

    resolvers[1](response("{}"));
    await flush();
    expect(settled).toEqual(["a", "b"]);
  });

  it("drops a task beyond ten waiting", async () => {
    const logs: string[] = [];
    const queue = createTaskQueue(
      () => {},
      (message) => logs.push(message),
      () => new Promise(() => {}),
    );

    for (let index = 0; index < 12; index++) {
      queue.enqueue(task(`t${index}`));
    }

    expect(queue.pending()).toBe(11); // one active + ten waiting
    expect(logs).toEqual(["task skipped: queue full (t11)"]);
    queue.stop();
  });

  it("stop aborts the request and drops callbacks", async () => {
    let signal: AbortSignal | undefined;
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
      (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
    );

    queue.enqueue(task("a"));
    queue.enqueue(task("b"));
    queue.stop();

    expect(signal?.aborted).toBe(true);
    expect(queue.pending()).toBe(0);

    queue.enqueue(task("c"));
    await flush();
    expect(settled).toEqual([]);
  });

  it("fails cleanly when fetch is missing", async () => {
    const settled: unknown[][] = [];
    const queue = createTaskQueue(
      (...args) => settled.push(args),
      () => {},
    );

    queue.enqueue(task("a"));
    await flush();

    expect(settled[0][2]).toBe("fetch is not available in this Node version");
  });
});
