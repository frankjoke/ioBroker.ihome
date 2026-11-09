import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_HELP,
  type AdapterPlugin,
  type PluginSettingDef,
} from "./plugin-ops";
import {
  applyPluginPatches,
  parsePluginsCommand,
  pluginView,
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

  it("clears help with an empty string and rejects overlong text", () => {
    const current = [userPlugin("u", true, "code", { help: "old" })];
    const cleared = applyPluginPatches(
      current,
      [{ id: "u", help: "" }],
      BUILTIN_PLUGINS,
    );
    expect(cleared.problems).toEqual([]);
    expect(cleared.plugins[0].help).toBeUndefined();
    expect(
      applyPluginPatches(
        current,
        [{ id: "u", help: "x".repeat(MAX_PLUGIN_HELP + 1) }],
        BUILTIN_PLUGINS,
      ).problems,
    ).not.toEqual([]);
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
      staged: false,
      removalPending: false,
    });
    expect(view).not.toHaveProperty("code");
  });

  it("exposes a bundled device template", () => {
    const bundle = {
      version: 1 as const,
      device: {
        controls: [{ state: "charge", feature: "value" }],
      },
    };
    const view = pluginView(userPlugin("u", true, "abcd", { bundle }), {
      status: "running",
      hotSettings: false,
      restartRequired: false,
    });
    expect(view.bundle).toEqual(bundle);
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
