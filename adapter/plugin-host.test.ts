import { describe, expect, it } from "vitest";
import type { AdapterPlugin } from "./plugin-ops";
import { createPluginHost, type PluginFactory } from "./plugin-host";
import type { PluginApi } from "./plugin-api";

const logs: string[] = [];

function plugin(
  id: string,
  code: string | undefined,
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
    settings: {},
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

  it("reports running, disabled and failed", async () => {
    const host = createPluginHost(
      [
        plugin("a", `module.exports = () => ({ async call() { return 1; } });`),
        plugin(
          "b",
          `module.exports = () => ({ async call() { return 2; } });`,
          5000,
          { enabled: false },
        ),
        plugin("c", "module.exports = ("),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(host.status("a")).toBe("running");
    expect(host.status("b")).toBe("disabled");
    expect(host.status("c")).toBe("failed");
    expect(host.status("missing")).toBe("disabled");
  });

  it("hot-enables a plugin disabled at startup", async () => {
    const host = createPluginHost(
      [
        plugin(
          "b",
          `module.exports = () => ({ async call() { return 42; } });`,
          5000,
          { enabled: false },
        ),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(host.canHotEnable("b", "code" as unknown as string)).toBe(false);
    expect(
      await host.setEnabled({
        ...plugin(
          "b",
          `module.exports = () => ({ async call() { return 42; } });`,
        ),
      }),
    ).toEqual({ ok: true, result: undefined });
    expect(host.status("b")).toBe("running");
    expect(await host.call("b", null)).toEqual({ ok: true, result: 42 });
  });

  it("refuses to enable when the stored code changed since startup", async () => {
    const host = createPluginHost(
      [
        plugin(
          "u",
          `module.exports = () => ({ async call() { return "old"; } });`,
          5000,
          { enabled: false },
        ),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    const reply = await host.setEnabled(
      plugin(
        "u",
        `module.exports = () => ({ async call() { return "new"; } });`,
      ),
    );
    expect(reply).toEqual({
      ok: false,
      error: expect.stringContaining("restart"),
    });
  });

  it("disables a running plugin and calls stop", async () => {
    const stopped: string[] = [];
    const host = createPluginHost(
      [
        plugin(
          "a",
          `module.exports = (api) => ({ async call() { return 1; }, async stop() { api.log.info("stop:a"); } });`,
        ),
      ],
      () => {
        const api = fakeApi();
        api.log.info = (message) => stopped.push(message);
        return api;
      },
      {},
      () => {},
    );
    await host.start();
    expect(
      await host.setEnabled(
        plugin(
          "a",
          `module.exports = (api) => ({ async call() { return 1; }, async stop() { api.log.info("stop:a"); } });`,
          5000,
          { enabled: false },
        ),
      ),
    ).toEqual({ ok: true, result: undefined });
    expect(stopped).toEqual(["stop:a"]);
    expect(host.status("a")).toBe("disabled");
    expect(host.has("a")).toBe(false);
  });

  it("refuses to hot-enable an unknown id and a builtin id is hot-enableable", async () => {
    const builtins: Record<string, PluginFactory> = {
      demo: () => ({
        async call() {
          return "builtin";
        },
      }),
    };
    const host = createPluginHost(
      [plugin("demo", undefined, 5000, { builtin: true, enabled: false })],
      fakeApi,
      builtins,
      () => {},
    );
    await host.start();
    expect(host.canHotEnable("demo")).toBe(true);
    expect(
      await host.setEnabled(plugin("missing", "module.exports = () => ({});")),
    ).toMatchObject({ ok: false });
    expect(
      await host.setEnabled(
        plugin("demo", undefined, 5000, { builtin: true, enabled: true }),
      ),
    ).toEqual({ ok: true, result: undefined });
    expect(host.status("demo")).toBe("running");
  });

  it("retries a failed plugin on enable", async () => {
    const code = `module.exports = () => ({
      async start() {
        if (globalThis.__pluginFail) throw new Error("start");
      },
      async call() { return "ok"; },
    });`;
    (globalThis as { __pluginFail?: boolean }).__pluginFail = true;
    const host = createPluginHost(
      [plugin("u", code, 5000, { enabled: false })],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(await host.setEnabled(plugin("u", code))).toEqual({
      ok: false,
      error: "start",
    });
    (globalThis as { __pluginFail?: boolean }).__pluginFail = false;
    expect(await host.setEnabled(plugin("u", code))).toEqual({
      ok: true,
      result: undefined,
    });
    expect(host.status("u")).toBe("running");
  });

  it("reports whether a loaded plugin has a reload hook", async () => {
    const host = createPluginHost(
      [
        plugin(
          "u",
          `module.exports = () => ({ async call() { return 1; }, async reload() {} });`,
        ),
      ],
      fakeApi,
      {},
      () => {},
    );
    await host.start();
    expect(host.hasReload("u")).toBe(true);
    expect(host.hasReload("missing")).toBe(false);
  });
});
