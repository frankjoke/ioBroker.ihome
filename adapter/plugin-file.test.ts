import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_CODE,
  MAX_PLUGIN_HELP,
} from "./plugin-ops";
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
      plugin: { ...base.plugin, api: 1, timeoutMs: 5000 },
    });
  });

  it("accepts a JSON string", () => {
    expect(parsePluginFile(JSON.stringify(base))).toEqual({
      plugin: { ...base.plugin, api: 1, timeoutMs: 5000 },
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

  it("keeps a device template bundle", () => {
    const bundle = {
      version: 1 as const,
      device: {
        name: "NUT UPS",
        type: "Custom",
        controls: [
          {
            state: "battery.charge",
            feature: "value",
            label: "Battery",
            unit: "%",
          },
        ],
      },
    };
    expect(
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, bundle },
      }),
    ).toEqual({
      plugin: { ...base.plugin, api: 1, timeoutMs: 5000, bundle },
    });
  });

  it("rejects invalid device templates", () => {
    const withBundle = (bundle: unknown) =>
      parsePluginFile({
        ...base,
        plugin: { ...base.plugin, bundle },
      });
    expect(withBundle({ version: 2, device: { controls: [] } })).toMatchObject({
      problem: expect.any(String),
    });
    expect(withBundle({ version: 1, device: { controls: [] } })).toMatchObject({
      problem: expect.any(String),
    });
    expect(
      withBundle({
        version: 1,
        device: { controls: [{ state: "x" }] },
      }),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      withBundle({
        version: 1,
        device: {
          controls: [{ state: "x", feature: "value" }],
          size: { w: 0, h: 1 },
        },
      }),
    ).toMatchObject({ problem: expect.any(String) });
  });

  it("parses a built-in settings file without code", () => {
    const httpIn = BUILTIN_PLUGINS.find((plugin) => plugin.id === "http.in");
    expect(
      parsePluginFile({
        ...base,
        plugin: {
          id: "http.in",
          name: "ignored name",
          builtin: true,
          timeoutMs: 4000,
          code: "",
          settings: { port: 3000, endpoints: "[]" },
        },
      }),
    ).toEqual({
      plugin: {
        id: "http.in",
        name: httpIn?.name,
        builtin: true,
        timeoutMs: 4000,
        settings: { port: 3000, endpoints: "[]" },
        code: "",
      },
    });
  });

  it("rejects invalid built-in settings files", () => {
    const builtinFile = (plugin: Record<string, unknown>) =>
      parsePluginFile({
        ...base,
        plugin: {
          id: "http.in",
          name: "x",
          builtin: true,
          code: "",
          ...plugin,
        },
      });
    expect(builtinFile({ id: "http.missing" })).toMatchObject({
      problem: expect.stringContaining("Unknown built-in"),
    });
    expect(builtinFile({ code: "x" })).toMatchObject({
      problem: expect.stringContaining("must not contain code"),
    });
    expect(builtinFile({ settings: { port: "3000" } })).toEqual({
      problem: expect.stringContaining("settings.port"),
    });
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
      plugin: { ...plugin, api: 1, timeoutMs: 5000 },
    });
    expect(JSON.parse(text).format).toBe("ihome-plugin");
    expect(JSON.parse(text).version).toBe(1);
  });
});

it("carries api and version, defaults api to 1 and rejects a newer api", () => {
  const code = "module.exports = () => ({ call() {} });";
  const parsed = parsePluginFile({
    format: "ihome-plugin",
    version: 1,
    plugin: { id: "demo", name: "Demo", code, api: 1, version: "1.2.3" },
  });
  expect(parsed).toMatchObject({ plugin: { api: 1, version: "1.2.3" } });
  const old = parsePluginFile({
    format: "ihome-plugin",
    version: 1,
    plugin: { id: "old", name: "Old", code },
  });
  expect(old).toMatchObject({ plugin: { api: 1 } });
  const newer = parsePluginFile({
    format: "ihome-plugin",
    version: 1,
    plugin: { id: "new", name: "New", code, api: 2 },
  });
  expect(newer).toMatchObject({
    problem: expect.stringContaining("plugin API"),
  });
  if ("plugin" in parsed) {
    expect(pluginFile(parsed.plugin).plugin).toMatchObject({
      api: 1,
      version: "1.2.3",
    });
  }
});

it("rejects a malformed version", () => {
  const code = "module.exports = () => ({ call() {} });";
  for (const version of [5, "", "x".repeat(33)]) {
    expect(
      parsePluginFile({
        format: "ihome-plugin",
        version: 1,
        plugin: { id: "v", name: "V", code, version },
      }),
    ).toMatchObject({ problem: expect.stringContaining("version") });
  }
});

it("accepts the retired external-access id as a user plugin", () => {
  const parsed = parsePluginFile({
    format: "ihome-plugin",
    version: 1,
    plugin: {
      id: "external-access",
      name: "External access (Caddy)",
      code: "module.exports = () => ({ call() {} });",
    },
  });
  expect(parsed).toMatchObject({ plugin: { id: "external-access" } });
});

it("round-trips settings tabs", () => {
  const tabs = [{ id: "endpoints", label: "Endpoints", fields: ["endpoints"] }];
  const settingsSchema = [
    { name: "endpoints", label: "Endpoints", type: "array", item: "string" },
  ];
  const parsed = parsePluginFile({
    ...base,
    plugin: { ...base.plugin, settingsSchema, settingsTabs: tabs },
  });
  expect(parsed).toMatchObject({ plugin: { settingsTabs: tabs } });
  if (!("plugin" in parsed)) return;
  expect(pluginFile(parsed.plugin).plugin.settingsTabs).toEqual(tabs);
  expect(
    parsePluginFile({
      ...base,
      plugin: { ...base.plugin, settingsTabs: tabs },
    }),
  ).toMatchObject({ problem: expect.stringContaining("tab") });
  expect(
    parsePluginFile({
      ...base,
      plugin: {
        ...base.plugin,
        settingsSchema,
        settingsTabs: [{ id: "x", label: "X", fields: ["missing"] }],
      },
    }),
  ).toMatchObject({ problem: expect.stringContaining("tab") });
});
