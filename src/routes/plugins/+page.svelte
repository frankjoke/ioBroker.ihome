<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import PluginList from "$lib/components/plugins/PluginList.svelte";
  import PluginImportModal from "$lib/components/plugins/PluginImportModal.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import { PLUGIN_GUIDE } from "$lib/config/plugin-guide";
  import {
    getPlugins,
    loadPlugins,
    pluginsError,
    pluginsLoading,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import type { PluginView } from "$adapter/plugin-admin";

  let busy = $state(false);
  let importOpen = $state(false);
  const plugins = $derived(getPlugins());
  const loading = $derived(pluginsLoading());
  const error = $derived(pluginsError());

  let wasConnected = false;
  $effect(() => {
    if (ioBroker.connected) {
      if (!wasConnected) {
        wasConnected = true;
        void loadPlugins().catch(() => {});
      }
    } else {
      wasConnected = false;
    }
  });

  async function refresh(): Promise<void> {
    busy = true;
    try {
      await loadPlugins();
    } catch {
      // The store exposes the message.
    } finally {
      busy = false;
    }
  }

  async function toggle(
    plugin: PluginView,
    field: "enabled" | "debug",
    value: boolean,
  ): Promise<void> {
    busy = true;
    try {
      await savePlugin({ id: plugin.id, [field]: value });
    } catch {
      // The store exposes the message.
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Plugins - iHome</title>
</svelte:head>

<div class="plugins-page">
  <div class="page-heading">
    <h1>Plugins</h1>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={busy || !ioBroker.connected}
        onclick={() => (importOpen = true)}
      >
        <span class="material-symbols-outlined">upload</span> Import
      </button>
      <button
        type="button"
        class="btn btn-sm"
        disabled={busy || !ioBroker.connected}
        onclick={refresh}
      >
        <span class="material-symbols-outlined">refresh</span> Refresh
      </button>
    </div>
  </div>

  <p class="warning-banner">
    User plugins run as Node code inside the adapter. Only import plugins you
    trust. Settings are visible in ioBroker — do not store passwords or tokens
    there.
  </p>

  <HelpSection help={PLUGIN_GUIDE} label="Plugin guide" />

  {#if !ioBroker.connected}
    <p class="hint text-muted">Not connected to ioBroker.</p>
  {/if}
  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}

  {#if loading && plugins.length === 0}
    <p class="hint text-muted">Loading plugins…</p>
  {:else if plugins.length === 0}
    <p class="hint text-muted">No plugins found.</p>
  {:else}
    <PluginList {plugins} {busy} onToggle={toggle} />
  {/if}
</div>

{#if importOpen}
  <PluginImportModal
    onClose={() => (importOpen = false)}
    onImported={() => {
      importOpen = false;
      void refresh();
    }}
  />
{/if}

<style>
  .plugins-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .warning-banner {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border-left: 3px solid var(--warning-color);
    border-radius: var(--border-radius);
    background: var(--surface-container-low);
    font-size: var(--body-sm);
  }
</style>
