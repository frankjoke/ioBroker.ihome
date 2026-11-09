import { describe, expect, it } from "vitest";
import type { AdapterPlugin, PluginSettingDef } from "./plugin-ops";
import type { ImportedPlugin } from "./plugin-file";
import {
  importStaged,
  mergePluginSettings,
  normalizeSettingsDoc,
  pluginSettingsChanged,
  pluginSettingsDoc,
  removeStaged,
  stageRemoval,
  type PluginSettingsDocument,
} from "./plugin-config";

function plugin(id: string, extra: Partial<AdapterPlugin> = {}): AdapterPlugin {
  return {
    id,
    name: id,
    enabled: true,
    builtin: false,
    timeoutMs: 5000,
    debug: false,
    code: `code-${id}`,
    ...extra,
  };
}

function imported(id: string): ImportedPlugin {
  return { id, name: id, code: `staged-${id}` };
}

const schema: PluginSettingDef[] = [
  { name: "port", label: "Port", type: "number" },
];

describe("plugin settings document", () => {
  it("captures availability, timeout, debug and metadata", () => {
    const doc = pluginSettingsDoc([
      plugin("a", {
        enabled: false,
        timeoutMs: 2000,
        debug: true,
        help: "Help",
        settings: { port: 80 },
        settingsSchema: schema,
      }),
    ]);
    expect(doc.settings.a).toEqual({
      enabled: false,
      timeoutMs: 2000,
      debug: true,
      help: "Help",
      settings: { port: 80 },
      settingsSchema: schema,
    });
    expect(doc.staged).toEqual([]);
    expect(doc.removals).toEqual([]);
  });

  it("merges state over native while keeping code and builtin metadata", () => {
    const native = [
      plugin("u", { code: "user-code" }),
      plugin("b", {
        builtin: true,
        code: undefined,
        help: "builtin help",
      }),
    ];
    const doc: PluginSettingsDocument = {
      version: 1,
      settings: {
        u: {
          enabled: false,
          timeoutMs: 1000,
          debug: true,
          help: "page help",
          settings: { port: 81 },
        },
        b: {
          enabled: false,
          timeoutMs: 3000,
          debug: true,
          help: "ignored",
          settings: { x: true },
        },
      },
      staged: [],
      removals: [],
    };
    const merged = mergePluginSettings(native, doc);
    expect(merged[0]).toMatchObject({
      id: "u",
      code: "user-code",
      enabled: false,
      timeoutMs: 1000,
      debug: true,
      help: "page help",
      settings: { port: 81 },
    });
    expect(merged[1]).toMatchObject({
      id: "b",
      enabled: false,
      timeoutMs: 3000,
      debug: true,
      help: "builtin help",
      settings: { x: true },
    });
  });

  it("normalizes JSON and drops invalid settings entries", () => {
    const doc = normalizeSettingsDoc(
      JSON.stringify({
        version: 1,
        settings: {
          good: { enabled: false, timeoutMs: 1000, debug: true },
          bad: { enabled: "no" },
        },
        staged: [imported("s")],
        removals: ["r", 3],
      }),
    );
    expect(doc?.settings.good).toMatchObject({ enabled: false });
    expect(doc?.settings.bad).toBeUndefined();
    expect(doc?.staged.map((entry) => entry.id)).toEqual(["s"]);
    expect(doc?.removals).toEqual(["r"]);
    expect(normalizeSettingsDoc("nope")).toBeNull();
  });

  it("stages, replaces and removes imports", () => {
    const base = pluginSettingsDoc([]);
    const one = importStaged(base, imported("s"));
    expect(one.staged).toHaveLength(1);
    const replaced = importStaged(one, { ...imported("s"), code: "new" });
    expect(replaced.staged).toHaveLength(1);
    expect(replaced.staged[0].code).toBe("new");
    expect(removeStaged(replaced, "s").staged).toEqual([]);
  });

  it("detects settings changes without treating an empty patch as one", () => {
    expect(pluginSettingsChanged(undefined, undefined)).toBe(false);
    expect(pluginSettingsChanged({}, {})).toBe(false);
    expect(pluginSettingsChanged({ port: 80 }, { port: 80 })).toBe(false);
    expect(pluginSettingsChanged({ port: 80 }, { port: 81 })).toBe(true);
    expect(pluginSettingsChanged(undefined, { port: 80 })).toBe(true);
  });

  it("deduplicates staged removals", () => {
    const base = pluginSettingsDoc([]);
    expect(stageRemoval(stageRemoval(base, "u"), "u").removals).toEqual(["u"]);
  });
});
