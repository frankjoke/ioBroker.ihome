import { describe, expect, it } from "vitest";
import type { AdapterPlugin } from "./plugin-ops";
import { createPluginHost, type PluginFactory } from "./plugin-host";
import type { PluginApi } from "./plugin-api";

const logs: string[] = [];

function plugin(
  id: string,
  code: string,
  timeoutMs = 5000,
  extra: Partial<AdapterPlugin> = {},
): AdapterPlugin {
  return {
    id,
    name: id,
    enabled: true,
    builtin: false,
    timeoutMs,
    code,
    ...extra,
  };
}

function fakeApi(): PluginApi {
  return {
    namespace: "ihome.0",
    config: {},
    log: {
      debug: (message) => logs.push(`debug:${message}`),
      info: (message) => logs.push(`info:${message}`),
      warn: (message) => logs.push(`warn:${message}`),
      error: (message) => logs.push(`error:${message}`),
    },
    state: {
      get: async () => undefined,
      set: async () => {},
      getForeign: async () => undefined,
      setForeign: async () => {},
    },
    objects: {
      get: async () => undefined,
      getForeign: async () => undefined,
    },
    network: { list: () => [], get: () => undefined },
    sendTo: async () => undefined,
  };
}

describe("createPluginHost", () => {
  it("keeps this state between start and call", async () => {
    const host = createPluginHost(
      [
        plugin(
          "demo",
          `module.exports = function () {
            return {
              value: 0,
              async start() { this.value = 41; },
              async call(p) { return this.value + p; },
            };
          };`,
        ),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(host.has("demo")).toBe(true);
    expect(await host.call("demo", 1)).toEqual({ ok: true, result: 42 });
  });

  it("serializes two calls and runs start before the first call", async () => {
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const createApi = (): PluginApi => {
      const api = fakeApi();
      api.log.info = (message) => order.push(message);
      return Object.assign(api, {
        gate: (name: string) =>
          new Promise<void>((resolve) => gates.set(name, resolve)),
      });
    };
    const host = createPluginHost(
      [
        plugin(
          "demo",
          `module.exports = function (api) {
            return {
              async start() { api.log.info("start"); },
              async call(p) {
                api.log.info("call:" + p);
                await api.gate(p);
                api.log.info("done:" + p);
                return p;
              },
            };
          };`,
        ),
      ],
      createApi,
      {},
      () => {},
    );
    await host.start();
    const a = host.call("demo", "a");
    const b = host.call("demo", "b");
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["start", "call:a"]);
    gates.get("a")?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["start", "call:a", "done:a", "call:b"]);
    gates.get("b")?.();
    expect(await a).toEqual({ ok: true, result: "a" });
    expect(await b).toEqual({ ok: true, result: "b" });
  });

  it("returns errors for compile, start, call and timeout failures and keeps later calls working", async () => {
    const host = createPluginHost(
      [
        plugin("bad-code", "module.exports = ("),
        plugin(
          "bad-start",
          `module.exports = () => ({ async start() { throw new Error("start"); }, async call() { return 1; } });`,
        ),
        plugin(
          "bad-call",
          `module.exports = () => ({ async call() { throw new Error("call"); } });`,
        ),
        plugin(
          "slow",
          `module.exports = () => ({ async call() { return new Promise(() => {}); } });`,
          100,
        ),
        plugin(
          "good",
          `module.exports = () => ({ async call() { return "ok"; } });`,
        ),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(await host.call("bad-code", null)).toMatchObject({ ok: false });
    expect(await host.call("bad-start", null)).toMatchObject({ ok: false });
    expect(await host.call("bad-call", null)).toEqual({
      ok: false,
      error: "call",
    });
    expect(await host.call("slow", null)).toEqual({
      ok: false,
      error: "timeout after 100 ms",
    });
    expect(await host.call("good", null)).toEqual({ ok: true, result: "ok" });
  });

  it("uses a builtin factory and skips disabled plugins", async () => {
    const started: string[] = [];
    const builtins: Record<string, PluginFactory> = {
      demo: () => ({
        async start() {
          started.push("demo");
        },
        async call() {
          return "builtin";
        },
      }),
    };
    const host = createPluginHost(
      [
        plugin("demo", "", 5000, { builtin: true }),
        plugin(
          "off",
          "module.exports = () => ({ async call() { return 1; } });",
          5000,
          {
            enabled: false,
          },
        ),
      ],
      fakeApi,
      builtins,
      () => {},
    );
    await host.start();
    expect(started).toEqual(["demo"]);
    expect(host.has("demo")).toBe(true);
    expect(host.has("off")).toBe(false);
    expect(await host.call("off", null)).toMatchObject({ ok: false });
    expect(await host.call("demo", null)).toEqual({
      ok: true,
      result: "builtin",
    });
  });

  it("runs stop in reverse order", async () => {
    const stopped: string[] = [];
    const createApi = (): PluginApi => {
      const api = fakeApi();
      api.log.info = (message) => stopped.push(message);
      return api;
    };
    const host = createPluginHost(
      [
        plugin(
          "a",
          `module.exports = (api) => ({ async call() { return 1; }, async stop() { api.log.info("stop:a"); } });`,
        ),
        plugin(
          "b",
          `module.exports = (api) => ({ async call() { return 2; }, async stop() { api.log.info("stop:b"); } });`,
        ),
      ],
      createApi,
      {},
      () => {},
    );
    await host.start();
    await host.stop();
    expect(stopped).toEqual(["stop:b", "stop:a"]);
    expect(host.has("a")).toBe(false);
  });

  it("returns an error for an unknown plugin", async () => {
    const host = createPluginHost([], fakeApi, {}, () => {});
    await host.start();
    expect(await host.call("missing", null)).toMatchObject({ ok: false });
  });
});
