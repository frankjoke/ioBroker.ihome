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

const collectionState = {
  id: "0_userdata.0.pv.total",
  type: "state" as const,
  common: {
    name: "Total",
    type: "number",
    role: "value",
    read: true,
    write: false,
  },
};
const collectionLogic = {
  id: "calc",
  name: "Calc",
  kind: "function" as const,
  expr: { code: "1" },
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

  it("accepts a retired device bundle with a warning and drops it", () => {
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
    const result = parsePluginFile({
      ...base,
      plugin: { ...base.plugin, bundle },
    });
    expect("plugin" in result && result.plugin.bundle).toBeUndefined();
    expect("plugin" in result && result.warnings?.[0]).toMatch(/bundle/i);
    expect(
      parsePluginFile({ ...base, plugin: { ...base.plugin, bundle: {} } }),
    ).toMatchObject({ warnings: [expect.stringMatching(/bundle/i)] });
  });

  it("parses a content-only plugin with a contribution", () => {
    const contributions = {
      tiles: [
        { id: "pair", name: "Pair", type: "Custom", features: [], slots: [] },
      ],
    };
    expect(
      parsePluginFile({
        ...base,
        plugin: { id: "demo.tiles", name: "Tiles", contributions },
      }),
    ).toEqual({
      plugin: {
        id: "demo.tiles",
        name: "Tiles",
        api: 1,
        timeoutMs: 5000,
        contributions,
      },
    });
  });

  it("accepts a code-less collection plugin", () => {
    const parsed = parsePluginFile({
      format: "ihome-plugin",
      version: 1,
      plugin: {
        id: "col.test",
        name: "Collection",
        version: "1.0.0",
        collection: {
          version: 1,
          states: [collectionState],
          logics: [collectionLogic],
        },
      },
    });
    expect("problem" in parsed).toBe(false);
    if (!("plugin" in parsed)) return;
    expect(parsed.plugin.collection?.logics).toHaveLength(1);
  });

  it("rejects a collection without a plugin version", () => {
    expect(
      parsePluginFile({
        format: "ihome-plugin",
        version: 1,
        plugin: {
          id: "col.test",
          name: "C",
          collection: {
            version: 1,
            states: [collectionState],
            logics: [collectionLogic],
          },
        },
      }),
    ).toHaveProperty("problem");
  });

  it("rejects a plugin with neither code nor contributions", () => {
    const withoutCode = { ...base.plugin } as Record<string, unknown>;
    delete withoutCode.code;
    expect(parsePluginFile({ ...base, plugin: withoutCode })).toMatchObject({
      problem: expect.stringMatching(/code, contributions or a collection/i),
    });
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
