import { describe, expect, it, vi } from "vitest";
import { createPluginApi, type PluginApiDeps } from "./plugin-api";

function fakeDeps(): PluginApiDeps {
  return {
    namespace: "ihome.0",
    config: { vapidPrivateKey: "secret", plugins: [{ id: "x" }] },
    networkDevices: [
      {
        id: "tv",
        name: "TV",
        host: "192.168.1.2",
        mac: "aa:bb:cc:dd:ee:ff",
        interval: 60,
        timeout: 2,
        port: 0,
      },
    ],
    getState: async (id) => ({ val: `own:${id}`, ack: true, ts: 1 }),
    setState: async () => {},
    getForeignState: async (id) => ({
      val: `foreign:${id}`,
      ack: true,
      ts: 1,
    }),
    setForeignState: async () => {},
    getObject: async (id) => ({ _id: id }),
    getForeignObject: async (id) => ({ _id: id }),
    sendTo: async (instance, command, payload) => ({
      instance,
      command,
      payload,
    }),
    settings: () => ({}),
    debug: () => false,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("createPluginApi", () => {
  it("maps relative and foreign state calls and defaults ack to false", async () => {
    const calls: unknown[] = [];
    const deps = fakeDeps();
    deps.setState = async (id, value, ack) =>
      calls.push(["own", id, value, ack]);
    deps.setForeignState = async (id, value, ack) =>
      calls.push(["foreign", id, value, ack]);
    const api = createPluginApi("demo", deps);

    expect(await api.state.get("network.tv.online")).toBe(
      "own:network.tv.online",
    );
    expect(await api.state.getForeign("0_userdata.0.X")).toBe(
      "foreign:0_userdata.0.X",
    );
    await api.state.set("network.tv.wake", true);
    await api.state.setForeign("0_userdata.0.X", 2, { ack: true });
    expect(calls).toEqual([
      ["own", "network.tv.wake", true, false],
      ["foreign", "0_userdata.0.X", 2, true],
    ]);
    expect(await api.sendTo("other.0", "cmd", { a: 1 })).toEqual({
      instance: "other.0",
      command: "cmd",
      payload: { a: 1 },
    });
  });

  it("exposes network devices and hides protected config", () => {
    const api = createPluginApi("demo", fakeDeps());
    expect(api.network.get("tv")).toMatchObject({
      id: "tv",
      host: "192.168.1.2",
      mac: "aa:bb:cc:dd:ee:ff",
    });
    expect(api.network.get("missing")).toBeUndefined();
    expect(api.network.list()).toHaveLength(1);
    expect(api.config).not.toHaveProperty("vapidPrivateKey");
    expect(api.config).not.toHaveProperty("plugins");
  });

  it("reads settings live and protects the source object", () => {
    let settings: Record<string, unknown> = { prefix: "a" };
    const deps = fakeDeps();
    deps.settings = () => settings;
    const api = createPluginApi("demo", deps);
    expect(api.settings.prefix).toBe("a");
    settings = { prefix: "b" };
    expect(api.settings.prefix).toBe("b");
    (api.settings as Record<string, unknown>).prefix = "hacked";
    expect(settings.prefix).toBe("b");
  });

  it("drops debug logs when debug is off and passes them when on", () => {
    let debug = false;
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const deps = fakeDeps();
    deps.log = log;
    deps.debug = () => debug;
    const api = createPluginApi("demo", deps);
    api.log.debug("x");
    expect(log.debug).not.toHaveBeenCalled();
    debug = true;
    api.log.debug("x");
    expect(log.debug).toHaveBeenCalledWith("plugin demo: x");
  });

  it("prefixes log lines with the plugin id", () => {
    const lines: string[] = [];
    const deps = fakeDeps();
    deps.log = {
      debug: (message) => lines.push(`debug:${message}`),
      info: (message) => lines.push(`info:${message}`),
      warn: (message) => lines.push(`warn:${message}`),
      error: (message) => lines.push(`error:${message}`),
    };
    const api = createPluginApi("demo", deps);
    api.log.warn("careful");
    expect(lines).toEqual(["warn:plugin demo: careful"]);
  });
});
