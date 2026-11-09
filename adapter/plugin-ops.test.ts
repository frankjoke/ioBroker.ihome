import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  DEFAULT_PLUGIN_TIMEOUT_MS,
  MAX_PLUGIN_CODE,
  MAX_PLUGIN_USAGE,
  parsePluginMessage,
  pluginConfigWithBuiltins,
  pluginError,
  pluginReply,
  seedBuiltinPlugins,
  settingsProblem,
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
        debug: false,
        code: "x",
      },
    ]);
  });

  it("keeps help, usage, debug and settings on a user plugin", () => {
    expect(
      validAdapterPlugins([
        {
          id: "my.plugin",
          name: "My plugin",
          code: "x",
          help: "Help",
          usage: "Usage",
          debug: true,
          settings: { host: "1.2.3.4" },
          settingsSchema: [{ name: "host", label: "Host", type: "string" }],
        },
      ]),
    ).toEqual([
      {
        id: "my.plugin",
        name: "My plugin",
        enabled: true,
        builtin: false,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: true,
        code: "x",
        help: "Help",
        usage: "Usage",
        settings: { host: "1.2.3.4" },
        settingsSchema: [{ name: "host", label: "Host", type: "string" }],
      },
    ]);
  });

  it("reads settings and schema from JSON strings", () => {
    const [plugin] = validAdapterPlugins([
      {
        id: "my.plugin",
        name: "My",
        code: "x",
        settings: '{"port":80}',
        settingsSchema: '[{"name":"port","label":"Port","type":"number"}]',
      },
    ]);
    expect(plugin.settings).toEqual({ port: 80 });
    expect(plugin.settingsSchema?.[0].type).toBe("number");
  });

  it("drops nested settings values instead of the plugin", () => {
    const [plugin] = validAdapterPlugins([
      {
        id: "my.plugin",
        name: "My",
        code: "x",
        settings: { nested: { a: 1 } },
      },
    ]);
    expect(plugin.id).toBe("my.plugin");
    expect(plugin.settings).toBeUndefined();
  });

  it("drops invalid optional metadata instead of the plugin", () => {
    const [plugin] = validAdapterPlugins([
      {
        id: "my.plugin",
        name: "My",
        code: "x",
        help: 42,
        usage: "x".repeat(MAX_PLUGIN_USAGE + 1),
        settings: "not json",
        settingsSchema: [{ nope: true }],
      },
    ]);
    expect(plugin.id).toBe("my.plugin");
    expect(plugin.help).toBeUndefined();
    expect(plugin.usage).toBeUndefined();
    expect(plugin.settings).toBeUndefined();
    expect(plugin.settingsSchema).toBeUndefined();
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
        debug: false,
        help: BUILTIN_PLUGINS[0].help,
        usage: BUILTIN_PLUGINS[0].usage,
        code: undefined,
      },
    ]);
  });

  it("gives every builtin help and usage", () => {
    for (const builtin of BUILTIN_PLUGINS) {
      expect(builtin.help?.trim()).toBeTruthy();
      expect(builtin.usage?.trim()).toBeTruthy();
    }
  });

  it("logs dropped and duplicate entries without changing the raw config", () => {
    const logs: string[] = [];
    const raw = [
      { id: "Bad", name: "Bad", enabled: true, code: "x" },
      { id: "good", name: "Good", enabled: true, code: "x" },
      { id: "good", name: "Duplicate", enabled: true, code: "y" },
    ];
    const valid = validAdapterPlugins(raw, BUILTIN_PLUGINS, (message) =>
      logs.push(message),
    );
    expect(valid.map((plugin) => plugin.id)).toEqual(["good"]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("Bad");
    expect(logs[1]).toContain("good");

    const next = pluginConfigWithBuiltins(raw);
    expect(next.slice(0, raw.length)).toEqual(raw);
    expect(next.slice(raw.length).map((entry) => entry.id)).toEqual(
      BUILTIN_PLUGINS.map((builtin) => builtin.id),
    );
  });

  it("seeds builtins into an empty config", () => {
    expect(pluginConfigWithBuiltins([])).toEqual(
      BUILTIN_PLUGINS.map((builtin) => ({
        id: builtin.id,
        name: builtin.name,
        enabled: true,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: false,
        code: undefined,
      })),
    );
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
        debug: false,
        code: "x",
      },
    ]);
  });
});

describe("settingsProblem", () => {
  const schema = [
    { name: "port", label: "Port", type: "number" as const },
    { name: "host", label: "Host", type: "string" as const },
    { name: "enabled", label: "Enabled", type: "boolean" as const },
    {
      name: "mode",
      label: "Mode",
      type: "select" as const,
      options: ["a", "b"],
    },
  ];

  it("rejects wrong types and unknown select options", () => {
    expect(settingsProblem(schema, { port: "80" })).toContain("port");
    expect(settingsProblem(schema, { enabled: 1 })).toContain("enabled");
    expect(settingsProblem(schema, { mode: "c" })).toContain("mode");
    expect(
      settingsProblem(schema, {
        port: 80,
        host: "x",
        enabled: true,
        mode: "a",
      }),
    ).toBeNull();
  });

  it("allows unknown keys and missing schema", () => {
    expect(settingsProblem(schema, { extra: "ok" })).toBeNull();
    expect(settingsProblem(undefined, { anything: [1, 2] })).toBeNull();
  });

  it("validates JSON text settings", () => {
    const jsonSchema = [
      { name: "endpoints", label: "Endpoints", type: "json" as const },
    ];
    expect(settingsProblem(jsonSchema, { endpoints: "[]" })).toBeNull();
    expect(settingsProblem(jsonSchema, { endpoints: "{oops" })).toContain(
      "endpoints",
    );
    expect(
      settingsProblem(jsonSchema, { endpoints: [] as unknown as string }),
    ).toContain("endpoints");
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
        debug: false,
        help: BUILTIN_PLUGINS[0].help,
        usage: BUILTIN_PLUGINS[0].usage,
        code: undefined,
      },
      {
        id: "mine",
        name: "Mine",
        enabled: true,
        builtin: false,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: false,
        code: "x",
      },
      {
        id: "network.wake",
        name: BUILTIN_PLUGINS[1].name,
        enabled: true,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: false,
        help: BUILTIN_PLUGINS[1].help,
        usage: BUILTIN_PLUGINS[1].usage,
        code: undefined,
      },
      {
        id: "http.in",
        name: BUILTIN_PLUGINS[2].name,
        enabled: true,
        builtin: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
        debug: false,
        help: BUILTIN_PLUGINS[2].help,
        usage: BUILTIN_PLUGINS[2].usage,
        settingsSchema: BUILTIN_PLUGINS[2].settingsSchema,
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
