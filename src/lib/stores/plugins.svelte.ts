import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { unwrapPluginReply } from "$lib/config/plugin-call";
import type { PluginPatch, PluginView } from "$adapter/plugin-admin";
import type { ImportedPlugin, PluginFile } from "$adapter/plugin-file";

interface PluginsResult {
  plugins: PluginView[];
  restartRequired?: string[];
}

let plugins = $state<PluginView[]>([]);
let loading = $state(false);
let error = $state("");

export function getPlugins(): PluginView[] {
  return plugins;
}

export function pluginsLoading(): boolean {
  return loading;
}

export function pluginsError(): string {
  return error;
}

async function command<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!ioBroker.connected) throw new Error("Not connected to ioBroker.");
  try {
    const reply = await ioBroker.sendTo(ioBroker.namespace, "plugins", {
      action,
      ...payload,
    });
    const result = unwrapPluginReply(reply) as T;
    error = "";
    return result;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    throw failure;
  }
}

export async function loadPlugins(): Promise<void> {
  loading = true;
  try {
    const result = await command<PluginsResult>("list");
    plugins = result.plugins;
    error = "";
  } finally {
    loading = false;
  }
}

export async function savePlugin(patch: PluginPatch): Promise<void> {
  const result = await command<PluginsResult>("save", { patches: [patch] });
  plugins = result.plugins;
}

export async function importPlugin(plugin: ImportedPlugin): Promise<void> {
  const result = await command<PluginsResult>("import", { plugin });
  plugins = result.plugins;
}

export async function deletePlugin(id: string): Promise<void> {
  const result = await command<PluginsResult>("delete", { id });
  plugins = result.plugins;
}

export async function exportPlugin(id: string): Promise<ImportedPlugin> {
  const file = await command<PluginFile>("export", { id });
  return file.plugin;
}
