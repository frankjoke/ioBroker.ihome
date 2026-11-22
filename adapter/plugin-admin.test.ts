import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGINS,
  MAX_PLUGIN_HELP,
  type AdapterPlugin,
  type PluginSettingDef,
} from "./plugin-ops";
import {
  applyPluginPatches,
  contributionsReply,
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

  it("carries the reason a plugin cannot be used", () => {
    const view = pluginView(userPlugin("u", true, "x"), {
      status: "failed",
      hotSettings: false,
      restartRequired: false,
      problem: "plugins/u/plugin.json is missing.",
    });
    expect(view.problem).toBe("plugins/u/plugin.json is missing.");
    expect(
      pluginView(userPlugin("u", true, "x"), {
        status: "running",
        hotSettings: false,
        restartRequired: false,
      }).problem,
    ).toBeUndefined();
  });

  it("exposes contribution counts and warnings, not the retired bundle", () => {
    const contributions = {
      tiles: [
        { id: "pair", name: "Pair", type: "Custom", features: [], slots: [] },
      ],
    };
    const view = pluginView(
      userPlugin("u", true, "abcd", {
        contributions,
        warnings: ["bundle retired"],
      }),
      {
        status: "running",
        hotSettings: false,
        restartRequired: false,
      },
    );
    expect(view.contributions).toEqual({ counts: { tiles: 1 }, total: 1 });
    expect(view.warnings).toEqual(["bundle retired"]);
    expect(view).not.toHaveProperty("bundle");
  });

  it("summarises an owned collection without its bodies", () => {
    const view = pluginView(
      userPlugin("col.test", true, "", {
        collection: {
          version: 1,
          states: [
            {
              id: "0_userdata.0.pv.total",
              type: "state",
              common: { name: "Total", type: "number" },
            },
          ],
          logics: [
            { id: "calc", name: "Calc", kind: "function", expr: { code: "1" } },
          ],
          uses: ["0_userdata.0.pv.power"],
        },
        contributions: {
          tiles: [
            { id: "t", name: "T", type: "Custom", features: [], slots: [] },
          ],
        },
      }),
      { status: "running", hotSettings: false, restartRequired: false },
    );
    expect(view.collection).toEqual({
      states: 1,
      logics: 1,
      tiles: 1,
      uses: 1,
    });
    expect(JSON.stringify(view)).not.toContain("0_userdata");
  });

  it("reports a content-only plugin as having no code", () => {
    const view = pluginView(
      userPlugin("u", true, "", {
        contributions: {
          snippets: [{ id: "s", name: "S", code: "sendTo()" }],
        },
      }),
      { status: "running", hotSettings: false, restartRequired: false },
    );
    expect(view.hasCode).toBe(false);
    expect(view.codeLength).toBe(0);
  });

  it("carries the secured flag", () => {
    const view = pluginView(userPlugin("u", true, "x", { secured: true }), {
      status: "running",
      hotSettings: false,
      restartRequired: false,
    });
    expect(view.secured).toBe(true);
  });
});

describe("contributionsReply", () => {
  it("returns every installed plugin with its envelope and problem", () => {
    const contributions = {
      tiles: [
        { id: "pair", name: "Pair", type: "Custom", features: [], slots: [] },
      ],
    };
    const reply = contributionsReply(
      [
        userPlugin("a", true, "", { contributions }),
        userPlugin("b", false, "x"),
      ],
      new Map([["a", "broken tile"]]),
    );
    expect(reply.plugins).toEqual([
      {
        id: "a",
        name: "a",
        enabled: true,
        contributions,
        problem: "broken tile",
      },
      { id: "b", name: "b", enabled: false, contributions: {} },
    ]);
  });
});

describe("secured patches", () => {
  it("sets and clears the flag", () => {
    const current = [userPlugin("u", true, "code")];
    const set = applyPluginPatches(
      current,
      [{ id: "u", secured: true }],
      BUILTIN_PLUGINS,
    );
    expect(set.problems).toEqual([]);
    expect(set.plugins[0].secured).toBe(true);
    const cleared = applyPluginPatches(
      set.plugins,
      [{ id: "u", secured: false }],
      BUILTIN_PLUGINS,
    );
    expect(cleared.plugins[0].secured).toBe(false);
  });

  it("rejects a non-boolean flag", () => {
    const result = applyPluginPatches(
      [userPlugin("u", true, "code")],
      [{ id: "u", secured: "yes" as unknown as boolean }],
      BUILTIN_PLUGINS,
    );
    expect(result.problems).not.toEqual([]);
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
    expect(parsePluginsCommand({ action: "reload", id: "u" })).toEqual({
      command: { action: "reload", id: "u" },
    });
    expect(parsePluginsCommand({ action: "install", id: "u" })).toEqual({
      command: { action: "install", id: "u" },
    });
    expect(parsePluginsCommand({ action: "remove", id: "u" })).toEqual({
      command: { action: "remove", id: "u" },
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

it("exposes the plugin api and version", () => {
  const view = pluginView(
    userPlugin("u", true, "x", { api: 1, version: "1.2.3" }),
    { status: "running", hotSettings: false, restartRequired: false },
  );
  expect(view).toMatchObject({ api: 1, version: "1.2.3" });
});

it("carries settings tabs into the view", () => {
  const tabs = [{ id: "rows", label: "Rows", fields: ["port"] }];
  const view = pluginView(
    userPlugin("u", true, "x", {
      settingsSchema: schema(),
      settingsTabs: tabs,
    }),
    { status: "running", hotSettings: true, restartRequired: false },
  );
  expect(view.settingsTabs).toEqual(tabs);
});
