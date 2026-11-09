import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parsePluginFile, pluginFile } from "$adapter/plugin-file";
import { NUT_EXAMPLE } from "./plugin-examples";

const nodeRequire = createRequire(import.meta.url);

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
});
