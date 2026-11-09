import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  type AdapterPlugin,
  type PluginSettingDef,
} from "./plugin-ops";
import {
  applyPluginPatches,
  parsePluginsCommand,
  pluginView,
  removeUserPlugin,
  stagePluginImport,
} from "./plugin-admin";

function schema(): PluginSettingDef[] {
  return [{ name: "port", label: "Port", type: "number" }];
}

function userPlugin(
  id: string,
  enabled: boolean,
  code: string,
  extra: Partial<AdapterPlugin> = {},
): AdapterPlugin {
  return {
    id,
    name: id,
    enabled,
    builtin: false,
    timeoutMs: 5000,
    debug: false,
    code,
    ...extra,
  };
}

function builtin(id: string): AdapterPlugin {
  const def = BUILTIN_PLUGINS.find((entry) => entry.id === id);
  if (!def) throw new Error(`unknown builtin ${id}`);
  return {
    id: def.id,
    name: def.name,
    enabled: true,
    builtin: true,
    timeoutMs: 5000,
    debug: false,
    ...(def.help ? { help: def.help } : {}),
    ...(def.usage ? { usage: def.usage } : {}),
    code: undefined,
  };
}

describe("applyPluginPatches", () => {
  it("keeps code and schema while patching metadata", () => {
    const current = [
      userPlugin("u", true, "code", { settingsSchema: schema() }),
    ];
    const { plugins, problems } = applyPluginPatches(
      current,
      [{ id: "u", name: "Renamed", debug: true }],
      BUILTIN_PLUGINS,
    );
    expect(problems).toEqual([]);
    expect(plugins[0].name).toBe("Renamed");
    expect(plugins[0].code).toBe("code");
    expect(plugins[0].settingsSchema).toEqual(schema());
    expect(plugins[0].debug).toBe(true);
  });

  it("rejects built-in name/help edits and unknown ids", () => {
    const current = [builtin("network.wake")];
    expect(
      applyPluginPatches(
        current,
        [{ id: "network.wake", name: "X" }],
        BUILTIN_PLUGINS,
      ).problems,
    ).not.toEqual([]);
    expect(
      applyPluginPatches(
        current,
        [{ id: "network.wake", help: "X" }],
        BUILTIN_PLUGINS,
      ).problems,
    ).not.toEqual([]);
    expect(
      applyPluginPatches(
        current,
        [{ id: "missing", enabled: false }],
        BUILTIN_PLUGINS,
      ).problems,
    ).not.toEqual([]);
  });

  it("validates settings against the existing schema", () => {
    const current = [
      userPlugin("u", true, "code", {
        settingsSchema: schema(),
        settings: { port: 80 },
      }),
    ];
    expect(
      applyPluginPatches(
        current,
        [{ id: "u", settings: { port: "80" } }],
        BUILTIN_PLUGINS,
      ).problems,
    ).not.toEqual([]);
    const ok = applyPluginPatches(
      current,
      [{ id: "u", settings: { port: 81 } }],
      BUILTIN_PLUGINS,
    );
    expect(ok.problems).toEqual([]);
    expect(ok.plugins[0].settings).toEqual({ port: 81 });
  });

  it("clamps timeout and keeps built-in metadata", () => {
    const current = [builtin("network.wake")];
    const { plugins, problems } = applyPluginPatches(
      current,
      [{ id: "network.wake", timeoutMs: 99_999, enabled: false }],
      BUILTIN_PLUGINS,
    );
    expect(problems).toEqual([]);
    expect(plugins[0].timeoutMs).toBe(30_000);
    expect(plugins[0].enabled).toBe(false);
    expect(plugins[0].name).toBe(BUILTIN_PLUGINS[1].name);
  });
});

describe("stagePluginImport", () => {
  it("stages an import disabled and replaces code", () => {
    const current = [userPlugin("u", true, "old")];
    const { plugins } = stagePluginImport(current, {
      id: "u",
      name: "U",
      code: "new",
    });
    expect(plugins[0].code).toBe("new");
    expect(plugins[0].enabled).toBe(false);
  });

  it("keeps existing settings when the import omits them", () => {
    const current = [userPlugin("u", true, "old", { settings: { port: 80 } })];
    const { plugins } = stagePluginImport(current, {
      id: "u",
      name: "U",
      code: "new",
    });
    expect(plugins[0].settings).toEqual({ port: 80 });
  });

  it("adds a new plugin disabled and rejects built-in ids", () => {
    const added = stagePluginImport([], {
      id: "demo.echo",
      name: "Echo",
      code: "x",
    });
    expect(added.plugins[0]).toMatchObject({
      id: "demo.echo",
      enabled: false,
      builtin: false,
      debug: false,
      timeoutMs: 5000,
    });
    expect(
      stagePluginImport([], {
        id: "network.wake",
        name: "Nope",
        code: "x",
      }).problem,
    ).toContain("built-in");
  });
});

describe("removeUserPlugin", () => {
  it("refuses built-ins and removes user plugins", () => {
    expect(
      removeUserPlugin([builtin("network.wake")], "network.wake").problem,
    ).toContain("built-in");
    expect(removeUserPlugin([userPlugin("u", true, "x")], "u").plugins).toEqual(
      [],
    );
  });
});

describe("pluginView", () => {
  it("copies metadata but never code", () => {
    const view = pluginView(userPlugin("u", true, "abcd", { help: "Help" }), {
      status: "running",
      hotSettings: true,
      restartRequired: false,
    });
    expect(view).toMatchObject({
      id: "u",
      help: "Help",
      status: "running",
      hotSettings: true,
      hasCode: true,
      codeLength: 4,
      restartRequired: false,
    });
    expect(view).not.toHaveProperty("code");
  });
});

describe("parsePluginsCommand", () => {
  it("parses every action", () => {
    expect(parsePluginsCommand({ action: "list" })).toEqual({
      command: { action: "list" },
    });
    expect(
      parsePluginsCommand({
        action: "save",
        patches: [{ id: "u", enabled: false }],
      }),
    ).toEqual({
      command: { action: "save", patches: [{ id: "u", enabled: false }] },
    });
    expect(
      parsePluginsCommand({
        action: "import",
        plugin: { id: "u", name: "U", code: "x" },
      }),
    ).toMatchObject({ command: { action: "import" } });
    expect(parsePluginsCommand({ action: "export", id: "u" })).toEqual({
      command: { action: "export", id: "u" },
    });
    expect(parsePluginsCommand({ action: "delete", id: "u" })).toEqual({
      command: { action: "delete", id: "u" },
    });
  });

  it("rejects invalid commands", () => {
    expect(parsePluginsCommand(null)).toMatchObject({
      problem: expect.any(String),
    });
    expect(parsePluginsCommand({ action: "nope" })).toMatchObject({
      problem: expect.any(String),
    });
    expect(parsePluginsCommand({ action: "save", patches: "x" })).toMatchObject(
      { problem: expect.any(String) },
    );
    expect(parsePluginsCommand({ action: "delete", id: "" })).toMatchObject({
      problem: expect.any(String),
    });
  });
});
