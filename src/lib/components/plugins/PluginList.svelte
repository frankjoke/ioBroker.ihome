<script lang="ts">
  import PluginEditor from "./PluginEditor.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deletePlugin, exportPlugin } from "$lib/stores/plugins.svelte";
  import { pluginFile, serializePluginFile } from "$adapter/plugin-file";
  import { downloadJson } from "$lib/utils/download";
  import { slugify } from "$lib/config/slug";
  import { deleteTitle } from "$lib/utils/delete-title";
  import type { PluginView } from "$adapter/plugin-admin";

  let {
    plugins,
    busy = false,
    onToggle,
  }: {
    plugins: PluginView[];
    busy?: boolean;
    onToggle: (
      plugin: PluginView,
      field: "enabled" | "debug",
      value: boolean,
    ) => void;
  } = $props();

  let selectedId = $state("");
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
    try {
      await deletePlugin(plugin.id);
      selectedId = "";
      resetDraft();
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
        <button
          type="button"
          class="name"
          aria-expanded={open}
          onclick={() => edit(plugin)}
        >
          {plugin.name}
        </button>
        <span class="mono hint text-muted">{plugin.id}</span>
        <span class="badge">{plugin.builtin ? "built-in" : "user"}</span>
        <span class="badge status-{plugin.status}"
          >{statusLabel(plugin.status)}</span
        >
        <span class="item-actions">
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
          {#if !plugin.builtin}
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
      </div>
      {#if open}
        <div class="item-editor">
          <PluginEditor
            bind:this={editorEl}
            {plugin}
            bind:dirty={editorDirty}
            bind:valid={editorValid}
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
      The plugin and its settings are removed after a restart in Admin.
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

  .restart {
    color: var(--warning-color);
  }

  .restart a {
    color: inherit;
  }
</style>
