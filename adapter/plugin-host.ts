import type { PluginApi } from "./plugin-api";
import {
  pluginError,
  pluginReply,
  type AdapterPlugin,
  type PluginReply,
} from "./plugin-ops";

export interface PluginModule {
  start?: () => unknown | Promise<unknown>;
  call?: (payload: unknown) => unknown | Promise<unknown>;
  stop?: () => unknown | Promise<unknown>;
}

export type PluginFactory = (api: PluginApi) => PluginModule;

export interface PluginHost {
  start(): Promise<void>;
  call(id: string, payload: unknown): Promise<PluginReply>;
  stop(): Promise<void>;
  has(id: string): boolean;
}

type PluginLog = (level: "info" | "warn" | "error", message: string) => void;

interface Loaded {
  call(payload: unknown): unknown;
  stop?: () => unknown;
  timeoutMs: number;
  tail: Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}timeout after ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function compile(plugin: AdapterPlugin): PluginFactory {
  const module = { exports: {} as unknown };
  const factory = new Function(
    "module",
    "exports",
    "require",
    plugin.code ?? "",
  ) as (
    module: { exports: unknown },
    exports: unknown,
    require: (id: string) => unknown,
  ) => void;
  factory(module, module.exports, require);
  if (typeof module.exports !== "function") {
    throw new Error("module.exports must be a function");
  }
  return module.exports as PluginFactory;
}

export function createPluginHost(
  plugins: AdapterPlugin[],
  createApi: (plugin: AdapterPlugin) => PluginApi,
  builtins: Record<string, PluginFactory>,
  log: PluginLog,
): PluginHost {
  const records = new Map<string, Loaded>();
  const failed = new Set<string>();
  const disabled = new Set<string>();

  return {
    has(id) {
      return records.has(id);
    },

    async start() {
      records.clear();
      failed.clear();
      disabled.clear();
      for (const plugin of plugins) {
        if (!plugin.enabled) {
          disabled.add(plugin.id);
          continue;
        }
        try {
          const factory = plugin.builtin
            ? builtins[plugin.id]
            : compile(plugin);
          if (!factory) {
            throw new Error("no builtin factory");
          }
          const instance = factory(createApi(plugin));
          if (!instance || typeof instance !== "object") {
            throw new Error("factory must return a plugin object");
          }
          if (typeof instance.call !== "function") {
            throw new Error("plugin needs a call method");
          }
          const loaded: Loaded = {
            call: instance.call.bind(instance) as (payload: unknown) => unknown,
            stop: instance.stop?.bind(instance) as (() => unknown) | undefined,
            timeoutMs: plugin.timeoutMs,
            tail: Promise.resolve(),
          };
          if (typeof instance.start === "function") {
            await withTimeout(
              Promise.resolve(instance.start.call(instance)),
              plugin.timeoutMs,
              "start ",
            );
          }
          records.set(plugin.id, loaded);
        } catch (error) {
          failed.add(plugin.id);
          log("warn", `plugin ${plugin.id}: ${errorText(error)}`);
        }
      }
    },

    async call(id, payload) {
      if (failed.has(id)) {
        return pluginError(`plugin ${id} is not available`);
      }
      if (disabled.has(id)) {
        return pluginError(`plugin ${id} is disabled`);
      }
      const record = records.get(id);
      if (!record) return pluginError(`unknown plugin: ${id}`);

      let outcome: PluginReply | undefined;
      const run = record.tail.then(async () => {
        try {
          outcome = pluginReply(
            await withTimeout(
              Promise.resolve(record.call(payload)),
              record.timeoutMs,
            ),
          );
        } catch (error) {
          outcome = pluginError(error);
        }
      });
      record.tail = run;
      await run;
      return outcome ?? pluginError(`plugin ${id} has no result`);
    },

    async stop() {
      for (const id of [...records.keys()].reverse()) {
        const record = records.get(id);
        if (!record) continue;
        try {
          await withTimeout(Promise.resolve(record.stop?.()), 1000, "stop ");
        } catch (error) {
          log("warn", `plugin ${id}: ${errorText(error)}`);
        }
      }
      records.clear();
      failed.clear();
      disabled.clear();
    },
  };
}
