<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import PluginList from "$lib/components/plugins/PluginList.svelte";
  import PluginPagesList from "$lib/components/plugins/PluginPagesList.svelte";
  import PluginImportModal from "$lib/components/plugins/PluginImportModal.svelte";
  import CollectionWizard from "$lib/components/plugins/CollectionWizard.svelte";
  import AvailablePlugins from "$lib/components/plugins/AvailablePlugins.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import { PLUGIN_GUIDE } from "$lib/config/plugin-guide";
  import { isLocalUi } from "$lib/config/session-locality.svelte";
  import { withoutSecured } from "$lib/config/secured";
  import {
    getPlugins,
    loadPlugins,
    pluginsError,
    pluginsLoading,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import type { PluginView } from "$adapter/plugin-admin";
  import { patchView, readView } from "$lib/stores/page-view";

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

  const savedView = readView("/plugins");
  const savedTab =
    savedView?.tab === "plugins" ||
    savedView?.tab === "pages" ||
    savedView?.tab === "help"
      ? savedView.tab
      : "plugins";
  let view = $state<View>(savedTab);
  let tabValue = $state<View | null>(savedTab);
  $effect(() => {
    patchView("/plugins", { tab: view });
  });
  let pagesRef = $state<{ startCreate: () => void } | null>(null);
  let pagesCanCreate = $state(false);
  let busy = $state(false);
  let importOpen = $state(false);
  let wizardOpen = $state(false);
  let wizardPlugin = $state<PluginView | undefined>(undefined);
  const plugins = $derived(withoutSecured(getPlugins(), isLocalUi()));
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
          <IconButton
            icon="add"
            label="Create plugin"
            disabled={busy || !ioBroker.connected}
            onclick={() => {
              wizardPlugin = undefined;
              wizardOpen = true;
            }}
          />
          <IconButton
            icon="upload"
            label="Import plugin"
            disabled={busy || !ioBroker.connected}
            onclick={() => (importOpen = true)}
          />
          <IconButton
            icon="refresh"
            label="Refresh plugins"
            disabled={busy || !ioBroker.connected}
            onclick={refresh}
          />
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
    {#if loading && plugins.length === 0}
      <p class="hint text-muted">Loading plugins…</p>
    {:else if plugins.length === 0}
      <p class="hint text-muted">No plugins found.</p>
    {:else}
      <PluginList
        {plugins}
        {busy}
        onToggle={toggle}
        initialOpenId={savedView?.openId ?? ""}
        onselect={(id) => patchView("/plugins", { openId: id })}
      />
    {/if}

    <AvailablePlugins />
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

{#if wizardOpen}
  <CollectionWizard
    plugin={wizardPlugin}
    onClose={() => (wizardOpen = false)}
    onSaved={() => {
      wizardOpen = false;
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
    margin-left: auto;
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
