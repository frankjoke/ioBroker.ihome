import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  DEFAULT_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_CODE,
  parsePluginMessage,
  pluginError,
  pluginReply,
  seedBuiltinPlugins,
  validAdapterPlugins,
} from "./plugin-ops";

describe("validAdapterPlugins", () => {
  it("normalizes a user plugin and applies the timeout default", () => {
    expect(
      validAdapterPlugins([
        { id: "my.plugin", name: "My plugin", enabled: true, code: "x" },
      ]),
    ).toEqual([
      {
        id: "my.plugin",
        name: "My plugin",
        enabled: true,
        builtin: false,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        code: "x",
      },
    ]);
  });

  it("accepts a builtin entry and ignores its code", () => {
    expect(
      validAdapterPlugins([
        {
          id: "network.info",
          name: "ignored",
          enabled: false,
          builtin: true,
          code: "ignored",
        },
      ]),
    ).toEqual([
      {
        id: "network.info",
        name: BUILTIN_PLUGINS[0].name,
        enabled: false,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        code: undefined,
      },
    ]);
  });

  it("rejects user code on reserved ids, unknown builtins, empty code, bad ids and overlong code", () => {
    expect(
      validAdapterPlugins([
        { id: "network.wake", name: "shadow", enabled: true, code: "x" },
        { id: "-oops", name: "bad", enabled: true, code: "x" },
        { id: "empty", name: "empty", enabled: true, code: "" },
        {
          id: "long",
          name: "long",
          enabled: true,
          code: "x".repeat(MAX_PLUGIN_CODE + 1),
        },
        { id: "mystery", name: "mystery", enabled: true, builtin: true },
      ]),
    ).toEqual([]);
  });

  it("keeps the first duplicate and clamps the timeout", () => {
    expect(
      validAdapterPlugins([
        { id: "a", name: "A", enabled: true, timeoutMs: 1, code: "x" },
        { id: "a", name: "A2", enabled: false, timeoutMs: 99_999, code: "y" },
      ]),
    ).toEqual([
      {
        id: "a",
        name: "A",
        enabled: true,
        builtin: false,
        timeoutMs: 100,
        code: "x",
      },
    ]);
  });
});

describe("seedBuiltinPlugins", () => {
  it("adds missing builtins and preserves user entries and disabled builtins", () => {
    expect(
      seedBuiltinPlugins([
        {
          id: "network.info",
          name: "ignored",
          enabled: false,
          builtin: true,
        },
        { id: "mine", name: "Mine", enabled: true, code: "x" },
      ]),
    ).toEqual([
      {
        id: "network.info",
        name: BUILTIN_PLUGINS[0].name,
        enabled: false,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        code: undefined,
      },
      {
        id: "mine",
        name: "Mine",
        enabled: true,
        builtin: false,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        code: "x",
      },
      {
        id: "network.wake",
        name: BUILTIN_PLUGINS[1].name,
        enabled: true,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        code: undefined,
      },
    ]);
  });
});

describe("parsePluginMessage", () => {
  it("accepts a record with a string id and optional payload", () => {
    expect(parsePluginMessage({ id: "network.info" })).toEqual({
      ok: true,
      message: { id: "network.info" },
    });
    expect(parsePluginMessage({ id: "x", payload: { a: 1 } })).toEqual({
      ok: true,
      message: { id: "x", payload: { a: 1 } },
    });
  });

  it("rejects non-records, missing ids and non-string ids", () => {
    expect(parsePluginMessage(null)).toMatchObject({ ok: false });
    expect(parsePluginMessage({ id: "" })).toMatchObject({ ok: false });
    expect(parsePluginMessage({ id: 3 })).toMatchObject({ ok: false });
  });
});

describe("plugin replies", () => {
  it("wraps results and errors", () => {
    expect(pluginReply({ sent: true })).toEqual({
      ok: true,
      result: { sent: true },
    });
    expect(pluginError(new Error("nope"))).toEqual({
      ok: false,
      error: "nope",
    });
    expect(pluginError("plain")).toEqual({ ok: false, error: "plain" });
  });
});
