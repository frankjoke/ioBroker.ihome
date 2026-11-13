<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import PluginList from "$lib/components/plugins/PluginList.svelte";
  import PluginPagesList from "$lib/components/plugins/PluginPagesList.svelte";
  import PluginImportModal from "$lib/components/plugins/PluginImportModal.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import {
    applyPluginBundle,
    bundleHash,
    deviceBundleHash,
    findPluginDevice,
  } from "$lib/config/plugin-bundle";
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
  let pendingBundle = $state<PluginView | null>(null);
  let bundleError = $state("");
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
    bundleError = "";
    let saved = false;
    try {
      await savePlugin({ id: plugin.id, [field]: value });
      saved = true;
    } catch {
      // The store exposes the message.
    } finally {
      busy = false;
    }
    if (!saved || field !== "enabled" || !value || !plugin.bundle) return;
    try {
      const existing = findPluginDevice(plugin.id);
      if (existing) {
        if (deviceBundleHash(existing) !== bundleHash(plugin.bundle)) {
          pendingBundle = plugin;
        }
      } else {
        applyPluginBundle(plugin);
      }
    } catch (failure) {
      bundleError =
        failure instanceof Error ? failure.message : String(failure);
    }
  }

  function applyBundle(): void {
    const plugin = pendingBundle;
    pendingBundle = null;
    if (!plugin) return;
    try {
      applyPluginBundle(plugin);
    } catch (failure) {
      bundleError =
        failure instanceof Error ? failure.message : String(failure);
    }
  }
</script>

<svelte:head>
  <title>Plugins - iHome</title>
</svelte:head>

<div class="plugins-page">
  <div class="page-heading">
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
    Plugins add extra functions to iHome. They run inside the iHome adapter
    alongside ioBroker, so only import plugins you trust. Settings are visible
    in ioBroker — do not store passwords or tokens there.
  </p>

  <HelpSection help={PLUGIN_GUIDE} label="Plugin guide" />

  {#if !ioBroker.connected}
    <p class="hint text-muted">Not connected to ioBroker.</p>
  {/if}
  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}
  {#if bundleError}
    <p class="text-danger hint">{bundleError}</p>
  {/if}

  {#if loading && plugins.length === 0}
    <p class="hint text-muted">Loading plugins…</p>
  {:else if plugins.length === 0}
    <p class="hint text-muted">No plugins found.</p>
  {:else}
    <PluginList {plugins} {busy} onToggle={toggle} />
  {/if}

  <PluginPagesList />
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

{#if pendingBundle}
  <ConfirmModal
    title="Update the generated device?"
    confirmLabel="Update"
    cancelLabel="Keep"
    onConfirm={applyBundle}
    onCancel={() => (pendingBundle = null)}
  >
    <p class="text-muted">
      {pendingBundle.name} already has a device from this plugin. Update it from the
      plugin template? Matching controls keep their ids, so tiles keep working.
    </p>
  </ConfirmModal>
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
    justify-content: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
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
