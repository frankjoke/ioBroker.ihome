<script lang="ts">
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { parsePluginFile } from "$adapter/plugin-file";
  import { BUILTIN_PLUGINS } from "$adapter/plugin-ops";
  import { writePluginFiles } from "$lib/config/plugin-storage";
  import {
    parsePluginCatalog,
    type PluginCatalogEntry,
  } from "$lib/config/plugin-catalog";
  import {
    getPlugins,
    installPlugin,
    loadPlugins,
    savePlugin,
  } from "$lib/stores/plugins.svelte";

  let entries = $state<PluginCatalogEntry[]>([]);
  let loading = $state(true);
  let error = $state("");
  let busy = $state("");
  let pending = $state<PluginCatalogEntry | null>(null);

  const installed = $derived(new Set(getPlugins().map((plugin) => plugin.id)));

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

  async function apply(entry: PluginCatalogEntry): Promise<void> {
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
      // The folder is the truth: write it first, then the adapter adds the
      // disabled runtime entry and reads the files back.
      await writePluginFiles(plugin);
      await installPlugin(plugin.id);
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
    if (busy) return;
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
                disabled={busy === entry.id}
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
</style>
