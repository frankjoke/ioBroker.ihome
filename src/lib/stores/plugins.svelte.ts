import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { unwrapPluginReply } from "$lib/config/plugin-call";
import type { PluginPatch, PluginView } from "$adapter/plugin-admin";
import type { ImportedPlugin, PluginFile } from "$adapter/plugin-file";
import type { CollectionConflict } from "$adapter/plugin-collection-types";

interface PluginsResult {
  plugins: PluginView[];
  restartRequired?: string[];
  collection?: { id: string; conflicts: CollectionConflict[] };
}

let plugins = $state<PluginView[]>([]);
let loading = $state(false);
let error = $state("");
let pluginsVersion = $state(0);

/** Changes whenever the plugin list, code or contributions may have changed. */
export function getPluginsVersion(): number {
  return pluginsVersion;
}

function bumpVersion(): void {
  pluginsVersion += 1;
}

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
    bumpVersion();
    error = "";
  } finally {
    loading = false;
  }
}

export async function savePlugin(patch: PluginPatch): Promise<void> {
  const result = await command<PluginsResult>("save", { patches: [patch] });
  plugins = result.plugins;
  bumpVersion();
}

export async function importPlugin(plugin: ImportedPlugin): Promise<void> {
  const result = await command<PluginsResult>("import", { plugin });
  plugins = result.plugins;
  bumpVersion();
}

export async function deletePlugin(id: string): Promise<void> {
  const result = await command<PluginsResult>("delete", { id });
  plugins = result.plugins;
  bumpVersion();
}

/** Re-read the plugin folder and restart it, no adapter restart. */
export async function reloadPlugin(id: string): Promise<void> {
  const result = await command<PluginsResult>("reload", { id });
  plugins = result.plugins;
  bumpVersion();
}

/** The folder was written by the page; add or refresh its runtime entry. */
export async function installPlugin(id: string): Promise<CollectionConflict[]> {
  const result = await command<PluginsResult>("install", { id });
  plugins = result.plugins;
  bumpVersion();
  return result.collection?.conflicts ?? [];
}

/** Retry a collection update after the user accepted overwriting conflicts. */
export async function applyCollection(
  id: string,
  overwrite = false,
): Promise<CollectionConflict[]> {
  const result = await command<PluginsResult>("collection.apply", {
    id,
    overwrite,
  });
  plugins = result.plugins;
  bumpVersion();
  return result.collection?.conflicts ?? [];
}

/** Drop the runtime entry; the caller removes the folder. */
export async function removePlugin(id: string): Promise<void> {
  const result = await command<PluginsResult>("remove", { id });
  plugins = result.plugins;
  bumpVersion();
}

export async function exportPlugin(id: string): Promise<ImportedPlugin> {
  const file = await command<PluginFile>("export", { id });
  return file.plugin;
}

/** Ask the adapter for a host's MAC from the local neighbour table. */
export async function lookupMac(host: string): Promise<string | undefined> {
  const result = await command<{ mac?: string | null }>("lookupMac", { host });
  return result.mac ?? undefined;
}
