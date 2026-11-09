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
  reload?: (api: PluginApi) => unknown | Promise<unknown>;
  stop?: () => unknown | Promise<unknown>;
}

export type PluginFactory = (api: PluginApi) => PluginModule;

export interface PluginRuntime {
  settings: Record<string, unknown>;
  debug: boolean;
}

export type PluginStatus = "running" | "disabled" | "failed";

export interface PluginHost {
  start(): Promise<void>;
  call(id: string, payload: unknown): Promise<PluginReply>;
  stop(): Promise<void>;
  has(id: string): boolean;
  status(id: string): PluginStatus;
  canHotEnable(id: string, code?: string): boolean;
  setEnabled(entry: AdapterPlugin): Promise<PluginReply>;
  hasReload(id: string): boolean;
}

type PluginLog = (level: "info" | "warn" | "error", message: string) => void;

interface Loaded {
  call(payload: unknown): unknown;
  start?: () => unknown;
  stop?: () => unknown;
  reload?: (api: PluginApi) => unknown;
  api: PluginApi;
  runtime: PluginRuntime;
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

function runtimeOf(plugin: AdapterPlugin): PluginRuntime {
  return {
    settings: { ...(plugin.settings ?? {}) },
    debug: plugin.debug === true,
  };
}

export function createPluginHost(
  plugins: AdapterPlugin[],
  createApi: (plugin: AdapterPlugin, runtime: PluginRuntime) => PluginApi,
  builtins: Record<string, PluginFactory>,
  log: PluginLog,
): PluginHost {
  const records = new Map<string, Loaded>();
  const failed = new Set<string>();
  const disabled = new Set<string>();
  const snapshot = new Map<string, string | undefined>(
    plugins.map((plugin) => [plugin.id, plugin.code]),
  );

  function load(plugin: AdapterPlugin): Loaded {
    const factory = plugin.builtin ? builtins[plugin.id] : compile(plugin);
    if (!factory) throw new Error("no builtin factory");
    const runtime = runtimeOf(plugin);
    const api = createApi(plugin, runtime);
    const instance = factory(api);
    if (!instance || typeof instance !== "object") {
      throw new Error("factory must return a plugin object");
    }
    if (typeof instance.call !== "function") {
      throw new Error("plugin needs a call method");
    }
    return {
      call: instance.call.bind(instance) as (payload: unknown) => unknown,
      start: instance.start?.bind(instance) as (() => unknown) | undefined,
      stop: instance.stop?.bind(instance) as (() => unknown) | undefined,
      reload: instance.reload?.bind(instance) as
        ((api: PluginApi) => unknown) | undefined,
      api,
      runtime,
      timeoutMs: plugin.timeoutMs,
      tail: Promise.resolve(),
    };
  }

  async function startPlugin(plugin: AdapterPlugin): Promise<Loaded> {
    const loaded = load(plugin);
    if (loaded.start) {
      await withTimeout(
        Promise.resolve(loaded.start()),
        plugin.timeoutMs,
        "start ",
      );
    }
    return loaded;
  }

  return {
    has(id) {
      return records.has(id);
    },

    status(id) {
      if (records.has(id)) return "running";
      if (failed.has(id)) return "failed";
      return "disabled";
    },

    canHotEnable(id, code) {
      return snapshot.has(id) && snapshot.get(id) === code;
    },

    hasReload(id) {
      return typeof records.get(id)?.reload === "function";
    },

    async setEnabled(entry) {
      const id = entry.id;
      if (!entry.enabled) {
        const record = records.get(id);
        if (record) {
          try {
            await withTimeout(Promise.resolve(record.stop?.()), 1000, "stop ");
          } catch (error) {
            log("warn", `plugin ${id}: ${errorText(error)}`);
          }
          records.delete(id);
        }
        failed.delete(id);
        disabled.add(id);
        return pluginReply(undefined);
      }
      if (records.has(id)) return pluginReply(undefined);
      if (!snapshot.has(id) || snapshot.get(id) !== entry.code) {
        return pluginError(`plugin ${id} needs an adapter restart`);
      }
      try {
        const loaded = await startPlugin({
          ...entry,
          code: snapshot.get(id),
        });
        records.set(id, loaded);
        failed.delete(id);
        disabled.delete(id);
        return pluginReply(undefined);
      } catch (error) {
        failed.add(id);
        disabled.delete(id);
        log("warn", `plugin ${id}: ${errorText(error)}`);
        return pluginError(error);
      }
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
          records.set(plugin.id, await startPlugin(plugin));
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
