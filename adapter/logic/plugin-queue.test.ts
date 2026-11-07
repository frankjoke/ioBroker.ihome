import { describe, expect, it } from "vitest";
import { createPluginQueue, type PluginCallTask } from "./plugin-queue";
import type { PluginReply } from "../plugin-ops";

const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function task(id: string): PluginCallTask {
  return { id, payload: null, depth: 0, run() {} };
}

describe("createPluginQueue", () => {
  it("serializes plugin calls and waits for done() before the next one", async () => {
    const order: string[] = [];
    const settled: unknown[] = [];
    const queue = createPluginQueue(
      async (id): Promise<PluginReply> => {
        order.push(`start:${id}`);
        return { ok: true, result: id };
      },
      (entry, data, error) => {
        order.push(`done:${entry.id}`);
        settled.push({ data, error });
      },
      () => {},
    );
    queue.enqueue(task("a"));
    queue.enqueue(task("b"));
    await tick();
    expect(order).toEqual(["start:a", "done:a"]);
    expect(settled).toHaveLength(1);
    queue.done();
    await tick();
    expect(order).toEqual(["start:a", "done:a", "start:b", "done:b"]);
    expect(settled).toHaveLength(2);
  });

  it("delivers an error for a failed call and continues", async () => {
    const settled: Array<{ data: unknown; error: string | null }> = [];
    const queue = createPluginQueue(
      async (id): Promise<PluginReply> =>
        id === "bad" ? { ok: false, error: "nope" } : { ok: true, result: id },
      (_entry, data, error) => settled.push({ data, error }),
      () => {},
    );
    queue.enqueue(task("bad"));
    await tick();
    expect(settled).toEqual([{ data: undefined, error: "nope" }]);
    queue.done();
    queue.enqueue(task("good"));
    await tick();
    expect(settled[1]).toEqual({ data: "good", error: null });
  });

  it("delivers a rejected call as an error", async () => {
    const settled: Array<{ data: unknown; error: string | null }> = [];
    const queue = createPluginQueue(
      async () => {
        throw new Error("boom");
      },
      (_entry, data, error) => settled.push({ data, error }),
      () => {},
    );
    queue.enqueue(task("x"));
    await tick();
    expect(settled).toEqual([{ data: undefined, error: "boom" }]);
  });

  it("stops waiting calls", async () => {
    const settled: unknown[] = [];
    const queue = createPluginQueue(
      async (id): Promise<PluginReply> => ({ ok: true, result: id }),
      (entry) => settled.push(entry.id),
      () => {},
    );
    queue.enqueue(task("a"));
    queue.enqueue(task("b"));
    queue.stop();
    await tick();
    expect(settled).toEqual([]);
    expect(queue.pending()).toBe(0);
  });
});
