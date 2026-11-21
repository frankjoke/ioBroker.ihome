import { describe, expect, it } from "vitest";
import type { PluginView } from "$adapter/plugin-admin";
import { pluginEditorTabs } from "./plugin-editor";

function view(extra: Partial<PluginView> = {}): PluginView {
  return {
    id: "u",
    name: "U",
    enabled: true,
    builtin: false,
    timeoutMs: 5000,
    debug: false,
    status: "running",
    hotSettings: false,
    hasCode: false,
    codeLength: 0,
    restartRequired: false,
    staged: false,
    removalPending: false,
    ...extra,
  } as PluginView;
}

describe("pluginEditorTabs", () => {
  it("shows Contributions for a content-only user plugin, no Code", () => {
    expect(pluginEditorTabs(view()).map((tab) => tab.id)).toEqual([
      "settings",
      "help",
      "contributions",
    ]);
  });

  it("shows Code only when the plugin has code", () => {
    expect(
      pluginEditorTabs(view({ hasCode: true })).map((tab) => tab.id),
    ).toEqual(["settings", "help", "contributions", "code"]);
  });

  it("keeps built-ins to Settings and Help", () => {
    expect(
      pluginEditorTabs(view({ builtin: true, hasCode: false })).map(
        (tab) => tab.id,
      ),
    ).toEqual(["settings", "help"]);
  });

  it("keeps declared settings tabs after Settings", () => {
    expect(
      pluginEditorTabs(
        view({
          settingsTabs: [{ id: "zone", label: "Zone", fields: [] }],
        }),
      ).map((tab) => tab.id),
    ).toEqual(["settings", "zone", "help", "contributions"]);
  });
});
