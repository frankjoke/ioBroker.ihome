import { describe, expect, it } from "vitest";
import { MAX_PLUGIN_CODE, MAX_PLUGIN_HELP } from "./plugin-ops";
import {
  parsePluginFile,
  pluginFile,
  serializePluginFile,
} from "./plugin-file";

const base = {
  format: "ihome-plugin",
  version: 1,
  plugin: {
    id: "demo.echo",
    name: "Echo",
    code: "module.exports = () => ({})",
  },
};

describe("parsePluginFile", () => {
  it("parses a valid file and defaults the timeout", () => {
    expect(parsePluginFile(base)).toEqual({
      plugin: { ...base.plugin, timeoutMs: 5000 },
    });
  });

  it("accepts a JSON string", () => {
    expect(parsePluginFile(JSON.stringify(base))).toEqual({
      plugin: { ...base.plugin, timeoutMs: 5000 },
    });
  });

  it("rejects built-in ids", () => {
    expect(
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, id: "network.wake" },
      }),
    ).toEqual({ problem: expect.stringContaining("built-in") });
  });

  it("rejects the wrong wrapper", () => {
    expect(parsePluginFile({ ...base, format: "other" })).toMatchObject({
      problem: expect.any(String),
    });
    expect(parsePluginFile({ ...base, version: 2 })).toMatchObject({
      problem: expect.any(String),
    });
    expect(parsePluginFile(null)).toMatchObject({
      problem: expect.any(String),
    });
  });

  it("rejects bad ids, names and code sizes", () => {
    expect(
      parsePluginFile({ ...base, plugin: { ...base.plugin, id: "Bad" } }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parsePluginFile({ ...base, plugin: { ...base.plugin, name: "" } }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parsePluginFile({ ...base, plugin: { ...base.plugin, code: "" } }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, code: "x".repeat(MAX_PLUGIN_CODE + 1) },
      }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, help: "x".repeat(MAX_PLUGIN_HELP + 1) },
      }),
    ).toMatchObject({ problem: expect.any(String) });
  });

  it("rejects an invalid schema or settings", () => {
    expect(
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, settingsSchema: [{ name: "port" }] },
      }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parsePluginFile({
        ...base,
        plugin: {
          ...base.plugin,
          settingsSchema: [{ name: "port", label: "Port", type: "number" }],
          settings: { port: "80" },
        },
      }),
    ).toEqual({ problem: expect.stringContaining("settings.port") });
  });
});

describe("plugin files", () => {
  it("round-trips the public file shape", () => {
    const plugin = { id: "demo.echo", name: "Echo", code: "x" } as const;
    const text = serializePluginFile(pluginFile(plugin));
    expect(parsePluginFile(JSON.parse(text))).toEqual({
      plugin: { ...plugin, timeoutMs: 5000 },
    });
    expect(JSON.parse(text).format).toBe("ihome-plugin");
    expect(JSON.parse(text).version).toBe(1);
  });
});
