import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parsePluginFile, pluginFile } from "$adapter/plugin-file";
import { NUT_EXAMPLE } from "./plugin-examples";

const nodeRequire = createRequire(import.meta.url);

const NUT_RESPONSE = [
  "BEGIN LIST VAR ups",
  'VAR ups ups.status "OL"',
  'VAR ups battery.charge "100"',
  'VAR ups ups.load "7"',
  "END LIST VAR ups",
  "",
].join("\n");

function fakeNet() {
  return {
    connect() {
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const socket = {
        setTimeout() {},
        on(event: string, handler: (arg?: unknown) => void) {
          handlers[event] = handler;
          return socket;
        },
        write() {
          queueMicrotask(() => handlers.data?.(Buffer.from(NUT_RESPONSE)));
        },
        destroy() {},
      };
      queueMicrotask(() => handlers.connect?.());
      return socket;
    },
  };
}

function makeApi(base: string | undefined) {
  const written = new Map<string, unknown>();
  const foreign = new Set<string>();
  const objects = new Map<string, unknown>();
  const api = {
    id: "nut.ups",
    namespace: "ihome.0",
    settings: {
      host: "localhost",
      port: 3493,
      ups: "ups",
      ...(base === undefined ? {} : { base }),
      interval: 30,
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    objects: {
      get: async (id: string) => objects.get(id),
      getForeign: async (id: string) => objects.get(id),
      set: async (id: string, object: unknown) => {
        objects.set(id, object);
      },
      setForeign: async (id: string, object: unknown) => {
        objects.set(id, object);
      },
    },
    state: {
      set: async (id: string, value: unknown) => {
        written.set(id, value);
      },
      setForeign: async (id: string, value: unknown) => {
        written.set(id, value);
        foreign.add(id);
      },
    },
  };
  return { api, written, foreign };
}

async function runExample(base: string | undefined) {
  const { api, written, foreign } = makeApi(base);
  const factory = new Function(
    "module",
    "exports",
    "require",
    NUT_EXAMPLE.code,
  );
  const module = { exports: {} as unknown };
  factory(module, module.exports, (id: string) => {
    if (id === "node:net") return fakeNet();
    throw new Error("unexpected require " + id);
  });
  const instance = (
    module.exports as (value: unknown) => {
      call: (payload: unknown) => Promise<unknown>;
    }
  )(api);
  const snapshot = await instance.call({ refresh: true });
  return { written, foreign, snapshot };
}

describe("NUT example", () => {
  it("is a valid importable plugin file", () => {
    const result = parsePluginFile(pluginFile(NUT_EXAMPLE));
    expect("problem" in result).toBe(false);
    if ("problem" in result) return;
    expect(result.plugin.id).toBe("nut.ups");
    expect(result.plugin.settings?.ups).toBe("ups");
    expect(result.plugin.code).toContain('require("node:net")');
    expect(result.plugin.code.length).toBeGreaterThan(1000);
  });

  it("compiles to a plugin module", () => {
    const factory = new Function(
      "module",
      "exports",
      "require",
      NUT_EXAMPLE.code,
    );
    const module = { exports: {} as unknown };
    factory(module, module.exports, nodeRequire);
    expect(typeof module.exports).toBe("function");
    const instance = (module.exports as (api: unknown) => unknown)({
      id: "nut.ups",
      namespace: "ihome.0",
      settings: { host: "localhost", port: 3493, ups: "ups", interval: 30 },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      objects: { get: async () => undefined, set: async () => {} },
      state: { set: async () => {} },
    }) as Record<string, unknown>;
    expect(instance).toMatchObject({
      start: expect.any(Function),
      call: expect.any(Function),
      reload: expect.any(Function),
      stop: expect.any(Function),
    });
  });

  it("writes under the configured base folder", async () => {
    const own = await runExample(undefined);
    expect(own.written.get("plugins.nut.ups.ups.status")).toBe("OL");
    expect(own.written.get("plugins.nut.ups.battery.charge")).toBe(100);
    expect(own.written.get("plugins.nut.ups.online")).toBe(true);
    expect(own.written.get("plugins.nut.ups.connected")).toBe(true);
    expect(own.foreign.size).toBe(0);
    expect(own.snapshot).toMatchObject({ connected: true, batteryCharge: 100 });

    const foreign = await runExample("0_userdata.0.nut");
    expect(foreign.written.get("0_userdata.0.nut.ups.status")).toBe("OL");
    expect(foreign.written.get("0_userdata.0.nut.connected")).toBe(true);
    expect(foreign.foreign.has("0_userdata.0.nut.ups.status")).toBe(true);
    expect(foreign.written.has("nut.ups.status")).toBe(false);
  });
});
