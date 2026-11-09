<script lang="ts">
  import PluginEditor from "./PluginEditor.svelte";
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

  function edit(plugin: PluginView): void {
    selectedId = selectedId === plugin.id ? "" : plugin.id;
  }

  function statusLabel(status: PluginView["status"]): string {
    if (status === "restart-required") return "restart required";
    return status;
  }
</script>

<div class="plugin-list">
  {#each plugins as plugin (plugin.id)}
    <div class="item" class:open={selectedId === plugin.id}>
      <div class="plugin-row">
        <div class="plugin-main">
          <button
            type="button"
            class="plugin-name"
            onclick={() => edit(plugin)}
          >
            {plugin.name}
          </button>
          <span class="plugin-id mono">{plugin.id}</span>
          <span class="badge">{plugin.builtin ? "built-in" : "user"}</span>
          <span class="badge status-{plugin.status}"
            >{statusLabel(plugin.status)}</span
          >
        </div>
        <div class="plugin-actions">
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
              ? "Available after an adapter restart"
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
          <button type="button" class="btn btn-sm" onclick={() => edit(plugin)}>
            Edit
          </button>
        </div>
        {#if plugin.removalPending}
          <p class="restart hint">
            Removal pending after an adapter restart.
            <a href="#/admin">Open Admin</a>
          </p>
        {:else if plugin.restartRequired}
          <p class="restart hint">
            Needs an adapter restart. <a href="#/admin">Open Admin</a>
          </p>
        {/if}
      </div>

      {#if selectedId === plugin.id}
        <div class="item-editor">
          <PluginEditor
            {plugin}
            onClose={() => (selectedId = "")}
            onSaved={() => (selectedId = "")}
            onDeleted={() => (selectedId = "")}
          />
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .plugin-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .item {
    gap: 0;
    padding: 0;
  }

  .plugin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
  }

  /* The card inside is the only white surface: no second box/border between
     the grey row and the editor. */
  .item-editor {
    display: contents;
  }

  .item > :global(.plugin-editor) {
    border: 0;
    border-radius: 0 0 var(--border-radius-sm, 6px) var(--border-radius-sm, 6px);
    box-shadow: none;
  }

  .plugin-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .plugin-name {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-color);
    font: inherit;
    font-weight: 600;
    text-align: left;
  }

  .plugin-name:hover {
    color: var(--primary-color);
  }

  .plugin-id {
    color: var(--text-muted);
    font-size: var(--body-sm);
  }

  .plugin-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
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

  .restart {
    flex: 1 1 100%;
    margin: 0;
    color: var(--warning-color);
  }

  .restart a {
    color: inherit;
  }
</style>
