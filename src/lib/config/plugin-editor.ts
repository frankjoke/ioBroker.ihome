import type { PluginView } from "$adapter/plugin-admin";

export interface PluginEditorTab {
  id: string;
  label: string;
  hint: string;
}

/** Built-ins keep their call timeout; content-only plugins have no calls. */
export function pluginShowsTimeout(plugin: PluginView): boolean {
  return plugin.builtin || plugin.hasCode;
}

/** The tabs the plugin editor shows for this plugin. */
export function pluginEditorTabs(plugin: PluginView): PluginEditorTab[] {
  const declared = (plugin.settingsTabs ?? [])
    .filter((tab) => tab.id !== "settings")
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      hint: `${tab.label} settings`,
    }));
  return [
    { id: "settings", label: "Settings", hint: "Runtime and plugin settings" },
    ...declared,
    { id: "help", label: "Help", hint: "Setup, usage and examples" },
    ...(plugin.builtin
      ? []
      : [
          {
            id: "contributions",
            label: "Contributions",
            hint: "Templates and snippets this plugin offers",
          },
        ]),
    ...(plugin.collection
      ? [
          {
            id: "collection",
            label: "Collection",
            hint: "States, logic and tiles this plugin owns",
          },
        ]
      : []),
    ...(plugin.hasCode && !plugin.builtin
      ? [{ id: "code", label: "Code", hint: "Plugin code and file state" }]
      : []),
  ];
}
