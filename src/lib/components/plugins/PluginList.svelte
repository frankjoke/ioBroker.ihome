<script lang="ts">
  import PluginEditor from "./PluginEditor.svelte";
  import { untrack } from "svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { exportPlugin, removePlugin } from "$lib/stores/plugins.svelte";
  import { removePluginFolder } from "$lib/config/plugin-storage";
  import { pluginFile, serializePluginFile } from "$adapter/plugin-file";
  import { downloadJson } from "$lib/utils/download";
  import { slugify } from "$lib/config/slug";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { nextAfterRemoval } from "$lib/utils/list-selection";
  import { adapterIcon } from "$lib/config/icon-ops";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import ioPackage from "../../../../io-package.json";
  import type { PluginView } from "$adapter/plugin-admin";

  let {
    plugins,
    busy = false,
    onToggle,
    onselect,
    onEditCollection,
    initialOpenId = "",
  }: {
    plugins: PluginView[];
    busy?: boolean;
    onToggle: (
      plugin: PluginView,
      field: "enabled" | "debug",
      value: boolean,
    ) => void;
    /** Reports the unfolded plugin (or null) so the page can remember it. */
    onselect?: (id: string | null) => void;
    /** Opens the capture wizard for a collection plugin. */
    onEditCollection?: (id: string) => void;
    /** The plugin that was open on the last visit, when it still exists. */
    initialOpenId?: string;
  } = $props();

  const homeAdapter = ioBroker.namespace.split(".")[0] ?? "ihome";
  const homeIcon = $derived(
    adapterIcon(ioBroker.objects as Map<string, any>, homeAdapter),
  );

  /** `built-in:<id>` / `user:<id>` — the row's kind tooltip. */
  const kindLabel = (plugin: PluginView): string =>
    `${plugin.builtin ? "built-in" : "user"}:${plugin.id}`;
  /** User manifests carry their own version; built-ins ship with iHome. */
  const versionLabel = (plugin: PluginView): string =>
    plugin.version
      ? `v${plugin.version}`
      : plugin.builtin
        ? `v${ioPackage.common.version}`
        : "";

  let selectedId = $state(
    untrack(() =>
      initialOpenId && plugins.some((plugin) => plugin.id === initialOpenId)
        ? initialOpenId
        : "",
    ),
  );
  let restored = untrack(() => selectedId !== "");
  $effect(() => {
    if (restored || !initialOpenId) return;
    if (!plugins.some((plugin) => plugin.id === initialOpenId)) return;
    restored = true;
    selectedId = initialOpenId;
  });
  $effect(() => {
    if (!restored && !selectedId) return;
    onselect?.(selectedId || null);
  });
  let editorEl = $state<{ save: () => void } | undefined>();
  let editorDirty = $state(false);
  let editorValid = $state(true);
  let exportingId = $state("");
  let rowError = $state("");
  let pendingDelete = $state<PluginView | null>(null);
  let pendingEdit = $state<PluginView | null>(null);
  let askDiscard = $state(false);

  function resetDraft(): void {
    rowError = "";
    editorDirty = false;
    editorValid = true;
  }

  function edit(plugin: PluginView): void {
    if (editorDirty) {
      pendingEdit = plugin;
      askDiscard = true;
      return;
    }
    resetDraft();
    selectedId = selectedId === plugin.id ? "" : plugin.id;
  }

  function discard(): void {
    askDiscard = false;
    const next = pendingEdit;
    pendingEdit = null;
    resetDraft();
    selectedId = next && next.id !== selectedId ? next.id : "";
  }

  function onLineClick(event: MouseEvent, plugin: PluginView): void {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    edit(plugin);
  }

  async function exportFile(plugin: PluginView): Promise<void> {
    rowError = "";
    if (exportingId) return;
    exportingId = plugin.id;
    try {
      const exported = await exportPlugin(plugin.id);
      downloadJson(
        `ihome-plugin-${slugify(exported.name) || "plugin"}.json`,
        serializePluginFile(pluginFile(exported)),
      );
    } catch (failure) {
      rowError = failure instanceof Error ? failure.message : String(failure);
    } finally {
      exportingId = "";
    }
  }

  async function remove(): Promise<void> {
    if (!pendingDelete) return;
    const plugin = pendingDelete;
    pendingDelete = null;
    rowError = "";
    const neighbor = nextAfterRemoval(plugins, plugin.id, (item) => item.id);
    const wasSelected = selectedId === plugin.id;
    try {
      await removePlugin(plugin.id);
      await removePluginFolder(plugin.id);
      if (wasSelected) {
        selectedId = neighbor?.id ?? "";
        resetDraft();
      }
    } catch (failure) {
      rowError = failure instanceof Error ? failure.message : String(failure);
    }
  }

  function statusLabel(status: PluginView["status"]): string {
    if (status === "restart-required") return "restart required";
    return status;
  }
</script>

<div class="plugin-list">
  {#each plugins as plugin (plugin.id)}
    {@const open = selectedId === plugin.id}
    <div class="item" class:open>
      <!-- The free line area is a mouse convenience: keyboard users use the
           name button. Controls keep their own hit areas. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(event) => onLineClick(event, plugin)}>
        <span class="plugin-icon" title={kindLabel(plugin)}>
          {#if plugin.builtin && homeIcon}
            <Icon value={homeIcon.value} owner={homeIcon.owner} size={18} />
          {:else}
            <Icon value="extension" size={18} />
          {/if}
        </span>
        <button
          type="button"
          class="name"
          title={kindLabel(plugin)}
          aria-expanded={open}
          onclick={() => edit(plugin)}
        >
          {plugin.name}
        </button>
        <span class="mono hint text-muted">{plugin.id}</span>
        {#if versionLabel(plugin)}
          <span class="badge">{versionLabel(plugin)}</span>
        {/if}
        <span class="item-actions">
          <span class="badge status-{plugin.status}"
            >{statusLabel(plugin.status)}</span
          >
          <label class="switch">
            <input
              type="checkbox"
              checked={plugin.enabled}
              disabled={busy ||
                (plugin.status === "restart-required" && !plugin.enabled)}
              onchange={(event) =>
                onToggle(plugin, "enabled", event.currentTarget.checked)}
            />
            <span>Enabled</span>
          </label>
          <label
            class="switch"
            title={plugin.staged
              ? "Available after a restart in Admin"
              : undefined}
          >
            <input
              type="checkbox"
              checked={plugin.debug}
              disabled={busy || plugin.staged}
              onchange={(event) =>
                onToggle(plugin, "debug", event.currentTarget.checked)}
            />
            <span>Debug logs</span>
          </label>
          {#if open}
            <IconButton
              icon="download"
              label={`Export ${plugin.name}`}
              title="Export"
              disabled={busy || exportingId === plugin.id}
              onclick={() => exportFile(plugin)}
            />
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={busy || !editorDirty || !editorValid}
              onclick={() => editorEl?.save()}
            >
              <span class="material-symbols-outlined">check</span> Save
            </button>
          {/if}
          {#if plugin.builtin}
            <span
              class="builtin-marker"
              title="Built-in — part of iHome"
              aria-hidden="true"
            >
              <Icon value="extension" size={18} />
            </span>
          {:else}
            <IconButton
              icon="delete"
              danger
              label={`Delete ${plugin.name}`}
              onclick={() => (pendingDelete = plugin)}
            />
          {/if}
        </span>
        {#if rowError && open}
          <p class="row-error text-danger hint">{rowError}</p>
        {/if}
        {#if plugin.removalPending}
          <p class="restart hint">
            Removal pending — restart iHome in Admin.
            <a href="#/admin">Open Admin</a>.
          </p>
        {:else if plugin.restartRequired}
          <p class="restart hint">
            Restart iHome in Admin to apply. <a href="#/admin">Open Admin</a>.
          </p>
        {/if}
        {#if plugin.problem}
          <p class="row-error text-danger hint">{plugin.problem}</p>
        {/if}
        {#if plugin.warnings?.length}
          <p class="row-error text-warning hint">
            {plugin.warnings.join(" ")}
          </p>
        {/if}
      </div>
      {#if open}
        <div class="item-editor">
          <PluginEditor
            bind:this={editorEl}
            {plugin}
            bind:dirty={editorDirty}
            bind:valid={editorValid}
            {onEditCollection}
            onSaved={() => {
              selectedId = "";
              resetDraft();
            }}
          />
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("plugin", pendingDelete.name)}
    confirmLabel="Delete"
    onConfirm={remove}
    onCancel={() => (pendingDelete = null)}
  >
    <p class="text-muted">
      The plugin and its code are removed now. Exported copies are unaffected.
    </p>
  </ConfirmModal>
{/if}

{#if askDiscard}
  <ConfirmModal
    title="Discard unsaved changes?"
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={discard}
    onCancel={() => {
      askDiscard = false;
      pendingEdit = null;
    }}
  >
    <p class="text-muted">
      The changes in {plugins.find((entry) => entry.id === selectedId)?.name ??
        "this plugin"} are not saved.
    </p>
  </ConfirmModal>
{/if}

<style>
  .plugin-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--body-sm);
    color: var(--text-muted);
    cursor: pointer;
  }

  .switch input {
    margin: 0;
  }

  .status-running {
    background: var(--success-color);
    color: #fff;
  }

  .status-disabled {
    background: var(--surface-container-high);
    color: var(--text-muted);
  }

  .status-failed {
    background: var(--danger-color);
    color: #fff;
  }

  .status-restart-required {
    background: var(--warning-color);
    color: var(--on-warning);
  }

  .row-error,
  .restart {
    flex: 1 1 100%;
    margin: 0;
  }

  .plugin-icon {
    display: inline-flex;
  }

  /* Built-ins cannot be deleted: a muted plugin glyph fills the bin's slot. */
  .builtin-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: var(--text-muted);
    opacity: 0.45;
  }

  .restart {
    color: var(--warning-color);
  }

  .restart a {
    color: inherit;
  }
</style>
