<script lang="ts">
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import CollectionConflicts from "./CollectionConflicts.svelte";
  import { parsePluginFile, type ImportedPlugin } from "$adapter/plugin-file";
  import { BUILTIN_PLUGINS } from "$adapter/plugin-ops";
  import { writePluginFiles } from "$lib/config/plugin-storage";
  import {
    parsePluginCatalog,
    type PluginCatalogEntry,
  } from "$lib/config/plugin-catalog";
  import {
    getPlugins,
    installPlugin,
    applyCollection,
    loadPlugins,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import type { CollectionConflict } from "$adapter/plugin-collection-types";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let entries = $state<PluginCatalogEntry[]>([]);
  let loading = $state(true);
  let error = $state("");
  let busy = $state("");
  let pending = $state<PluginCatalogEntry | null>(null);
  let conflicts = $state<{
    id: string;
    list: CollectionConflict[];
  } | null>(null);
  let pendingMissing = $state<{
    entry: PluginCatalogEntry;
    ids: string[];
  } | null>(null);

  function missingStates(plugin: ImportedPlugin): string[] {
    return (plugin.collection?.states ?? [])
      .map((state) => state.id)
      .filter((id) => !ioBroker.objects.has(id) && !ioBroker.states.has(id));
  }

  const installed = $derived(new Set(getPlugins().map((plugin) => plugin.id)));
  /** Installed state is only trustworthy once the plugin list has arrived. */
  const listReady = $derived(ioBroker.connected && getPlugins().length > 0);

  onMount(() => {
    void loadCatalog();
  });

  async function loadCatalog(): Promise<void> {
    loading = true;
    error = "";
    try {
      const response = await fetch(`${base}/plugins/index.json`, {
        cache: "no-cache",
      });
      if (response.status === 404) {
        entries = [];
        return;
      }
      if (!response.ok) {
        throw new Error(
          `Plugin catalog unavailable (HTTP ${response.status}).`,
        );
      }
      const catalog = parsePluginCatalog(
        await response.json(),
        BUILTIN_PLUGINS.map((plugin) => plugin.id),
      );
      if (!catalog) throw new Error("The plugin catalog is unreadable.");
      entries = catalog.plugins;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      entries = [];
    } finally {
      loading = false;
    }
  }

  async function apply(
    entry: PluginCatalogEntry,
    skipMissing = false,
  ): Promise<void> {
    if (!listReady) return;
    pending = null;
    busy = entry.id;
    error = "";
    try {
      const response = await fetch(`${base}/plugins/${entry.file}`, {
        cache: "no-cache",
      });
      if (!response.ok) {
        throw new Error(`Plugin file unavailable (HTTP ${response.status}).`);
      }
      const parsed = parsePluginFile(await response.text());
      if ("problem" in parsed) throw new Error(parsed.problem);
      const plugin = parsed.plugin;
      if (plugin.id !== entry.id) {
        throw new Error("The plugin file names another id.");
      }
      if (!skipMissing) {
        const missing = missingStates(plugin);
        if (missing.length > 0) {
          pendingMissing = { entry, ids: missing };
          return;
        }
      }
      // The folder is the truth: write it first, then the adapter adds the
      // disabled runtime entry and reads the files back.
      await writePluginFiles(plugin);
      const installedConflicts = await installPlugin(plugin.id);
      if (installedConflicts.length > 0) {
        conflicts = { id: plugin.id, list: installedConflicts };
        return;
      }
      if (plugin.settings || plugin.timeoutMs !== undefined) {
        await savePlugin({
          id: plugin.id,
          ...(plugin.timeoutMs !== undefined
            ? { timeoutMs: plugin.timeoutMs }
            : {}),
          ...(plugin.settings ? { settings: plugin.settings } : {}),
        });
      }
      await loadPlugins();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = "";
    }
  }

  function install(entry: PluginCatalogEntry): void {
    if (busy || !listReady) return;
    if (installed.has(entry.id)) pending = entry;
    else void apply(entry);
  }
</script>

<section class="available">
  <h3>Available plugins</h3>
  <p class="hint text-muted">
    Curated by the iHome project. Code runs inside the adapter; only install
    plugins you trust.
  </p>
  {#if loading}
    <p class="hint text-muted">Loading…</p>
  {:else if entries.length > 0}
    <div class="list">
      {#each entries as entry (entry.id)}
        <div class="item">
          <div class="item-line">
            <Icon value="extension" size={18} />
            <span class="available-name">{entry.name}</span>
            <span class="mono hint text-muted">{entry.id}</span>
            <span class="badge">v{entry.version}</span>
            <span class="item-actions">
              <span class="mono hint text-muted">API {entry.api}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={!listReady || busy !== ""}
                onclick={() => install(entry)}
              >
                {installed.has(entry.id) ? "Reinstall" : "Install"}
              </button>
            </span>
          </div>
          <p class="hint text-muted description">{entry.description}</p>
        </div>
      {/each}
    </div>
  {:else if !error}
    <p class="hint text-muted">No plugins are available in this build.</p>
  {/if}
  {#if error}
    <p class="hint text-danger">{error}</p>
  {/if}
</section>

{#if pendingMissing}
  <ConfirmModal
    title="Create missing states?"
    confirmLabel="Create and install"
    onConfirm={() => {
      const pendingEntry = pendingMissing;
      pendingMissing = null;
      if (pendingEntry) void apply(pendingEntry.entry, true);
    }}
    onCancel={() => (pendingMissing = null)}
  >
    <p class="text-muted">
      These declared states do not exist on this instance yet. The plugin owns
      them; install will create the state objects with their definitions. State
      values are not part of the plugin.
    </p>
    <ul class="missing-states">
      {#each pendingMissing.ids as stateId (stateId)}
        <li class="mono">{stateId}</li>
      {/each}
    </ul>
  </ConfirmModal>
{/if}

{#if conflicts}
  <CollectionConflicts
    conflicts={conflicts.list}
    onCancel={() => (conflicts = null)}
    onOverwrite={() => {
      const id = conflicts?.id;
      conflicts = null;
      if (!id) return;
      void applyCollection(id, true)
        .then(() => loadPlugins())
        .catch((failure) => {
          error = failure instanceof Error ? failure.message : String(failure);
        });
    }}
  />
{/if}

{#if pending}
  <ConfirmModal
    title={`Reinstall ${pending.name}?`}
    confirmLabel="Reinstall"
    onConfirm={() => {
      if (pending) void apply(pending);
    }}
    onCancel={() => (pending = null)}
  >
    This replaces the installed files and settings with the catalog version
    {pending.version}.
  </ConfirmModal>
{/if}

<style>
  .available {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .available h3 {
    margin: 0;
    font-size: var(--headline-sm);
  }

  .available-name {
    font-weight: 500;
  }

  .description {
    margin: 0.25rem 0.5rem 0;
  }

  .missing-states {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
  }
</style>
