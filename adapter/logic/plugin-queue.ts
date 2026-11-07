import type { PluginReply } from "../plugin-ops";

/** One settled plugin call waiting for its logic callback to run. */
export interface PluginCallTask {
  id: string;
  payload: unknown;
  depth: number;
  run(data: unknown, error: string | null): void;
}

export interface PluginQueue {
  enqueue(task: PluginCallTask): void;
  /** The callback job finished; start the next call. */
  done(): void;
  stop(): void;
  /** In flight + waiting; for tests. */
  pending(): number;
}

export const PLUGIN_MAX_WAITING = 10;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function okReply(reply: PluginReply): reply is { ok: true; result: unknown } {
  return reply.ok === true;
}

/**
 * One FIFO queue per logic. The active slot stays taken until the engine calls
 * `done()` after the callback, so two plugin callbacks never interleave.
 */
export function createPluginQueue(
  call: (id: string, payload: unknown) => Promise<PluginReply>,
  onSettled: (
    task: PluginCallTask,
    data: unknown,
    error: string | null,
  ) => void,
  log: (message: string) => void,
): PluginQueue {
  const waiting: PluginCallTask[] = [];
  let active: PluginCallTask | undefined;
  let stopped = false;

  const pump = (): void => {
    if (stopped || active || waiting.length === 0) return;
    const task = waiting.shift();
    if (!task) return;
    active = task;
    void call(task.id, task.payload).then(
      (reply) => {
        if (stopped) return;
        if (okReply(reply)) onSettled(task, reply.result, null);
        else onSettled(task, undefined, reply.error);
      },
      (error) => {
        if (!stopped) onSettled(task, undefined, errorText(error));
      },
    );
  };

  return {
    enqueue(task) {
      if (stopped) return;
      if (waiting.length >= PLUGIN_MAX_WAITING) {
        log(`task skipped: plugin queue full (${task.id})`);
        onSettled(task, undefined, "plugin queue full");
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
      active = undefined;
    },
    pending() {
      return (active ? 1 : 0) + waiting.length;
    },
  };
}
