<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
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

  type View = "plugins" | "pages" | "help";

  const tabs: Array<{ id: View; label: string; hint: string }> = [
    {
      id: "plugins",
      label: "Plugins",
      hint: "Installed plugins and their settings.",
    },
    {
      id: "pages",
      label: "Pages",
      hint: "Admin tabs and extra pages in the cog menu.",
    },
    {
      id: "help",
      label: "Help",
      hint: "About plugins and pages.",
    },
  ];

  let view = $state<View>("plugins");
  let tabValue = $state<View | null>("plugins");
  let pagesRef = $state<{ startCreate: () => void } | null>(null);
  let pagesCanCreate = $state(false);
  let busy = $state(false);
  let importOpen = $state(false);
  let pendingBundle = $state<PluginView | null>(null);
  let bundleError = $state("");
  const plugins = $derived(getPlugins());
  const loading = $derived(pluginsLoading());
  const error = $derived(pluginsError());

  function onView(next: View | null) {
    view = next ?? "plugins";
    tabValue = view;
  }

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
  <div class="item">
    <div class="item-line title-line">
      <div class="tabs-line">
        <OptionTabs
          bind:value={tabValue}
          label="Plugins section"
          {tabs}
          collapsible={false}
          showHint={false}
          onchange={onView}
        />
      </div>
      {#if view === "plugins"}
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
            class="btn btn-outline btn-sm"
            disabled={busy || !ioBroker.connected}
            onclick={refresh}
          >
            <span class="material-symbols-outlined">refresh</span> Refresh
          </button>
        </div>
      {:else if view === "pages"}
        <div class="page-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!pagesCanCreate}
            title={pagesCanCreate ? "Add a page" : "Save the open page first"}
            onclick={() => pagesRef?.startCreate()}
          >
            <span class="material-symbols-outlined">add</span> Page
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="tab-panel" hidden={view !== "plugins"}>
    <p class="warning-banner">
      Plugins add extra functions to iHome. They run inside the iHome adapter
      alongside ioBroker, so only import plugins you trust. Settings are visible
      in ioBroker — do not store passwords or tokens there.
    </p>

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
  </div>

  <div class="tab-panel" hidden={view !== "pages"}>
    <PluginPagesList bind:this={pagesRef} bind:canCreate={pagesCanCreate} />
  </div>

  {#if view === "help"}
    <div class="card help-panel">
      <HelpSection help={PLUGIN_GUIDE} static plain />
    </div>
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

  .title-line {
    cursor: default;
  }

  .tabs-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
