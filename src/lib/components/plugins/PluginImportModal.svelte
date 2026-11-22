<script lang="ts">
  import {
    importPlugin,
    installPlugin,
    applyCollection,
    loadPlugins,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import CollectionConflicts from "./CollectionConflicts.svelte";
  import type { CollectionConflict } from "$adapter/plugin-collection-types";
  import { writePluginFiles } from "$lib/config/plugin-storage";
  import { parsePluginFile, type ImportedPlugin } from "$adapter/plugin-file";
  import { NUT_EXAMPLE } from "$lib/config/plugin-examples";

  let {
    onClose,
    onImported,
  }: {
    onClose: () => void;
    onImported: () => void;
  } = $props();

  let plugin = $state<ImportedPlugin | null>(null);
  let fileName = $state("");
  let error = $state("");
  let warnings = $state<string[]>([]);
  let busy = $state(false);
  let conflicts = $state<{
    id: string;
    list: CollectionConflict[];
  } | null>(null);
  let missingStates = $state<string[]>([]);

  function missingCollectionStates(value: ImportedPlugin): string[] {
    return (value.collection?.states ?? [])
      .map((state) => state.id)
      .filter((id) => !ioBroker.objects.has(id) && !ioBroker.states.has(id));
  }

  function contributionCount(value: ImportedPlugin): number {
    return Object.values(value.contributions ?? {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0,
    );
  }

  async function choose(event: Event): Promise<void> {
    error = "";
    warnings = [];
    plugin = null;
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName = file.name;
    const parsed = parsePluginFile(await file.text());
    if ("problem" in parsed) {
      error = parsed.problem;
      return;
    }
    plugin = parsed.plugin;
    warnings = parsed.warnings ?? [];
  }

  function loadExample(): void {
    error = "";
    warnings = [];
    fileName = "NUT UPS example";
    plugin = NUT_EXAMPLE;
  }

  async function confirm(): Promise<void> {
    if (!plugin || busy) return;
    const missing = plugin.builtin ? [] : missingCollectionStates(plugin);
    if (missing.length > 0) {
      missingStates = missing;
      return;
    }
    await doImport(plugin);
  }

  async function doImport(value: ImportedPlugin): Promise<void> {
    if (busy) return;
    error = "";
    busy = true;
    try {
      if (!value.builtin) {
        // The folder is the truth: write it first, then let the adapter add
        // the disabled runtime entry and read the files back.
        await writePluginFiles(value);
        const installedConflicts = await installPlugin(value.id);
        if (installedConflicts.length > 0) {
          conflicts = { id: value.id, list: installedConflicts };
          return;
        }
        if (value.settings || value.timeoutMs !== undefined) {
          await savePlugin({
            id: value.id,
            ...(value.timeoutMs !== undefined
              ? { timeoutMs: value.timeoutMs }
              : {}),
            ...(value.settings ? { settings: value.settings } : {}),
          });
        }
      } else {
        await importPlugin(value);
      }
      onImported();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Import plugin">
  <div class="modal-card card">
    <h3>Import plugin</h3>
    <p class="hint text-muted">
      {#if plugin?.builtin}
        Choose a built-in plugin settings file. Its settings are applied
        immediately; the built-in code stays untouched.
      {:else}
        Choose an iHome plugin file. The plugin is added switched off; enable it
        here when you are ready.
      {/if}
    </p>

    <label class="field">
      <span class="label-mono">Plugin file</span>
      <input type="file" accept=".json,application/json" onchange={choose} />
    </label>

    {#if fileName}
      <p class="hint text-muted mono">{fileName}</p>
    {/if}

    {#if error}
      <p class="text-danger hint">{error}</p>
    {/if}

    {#if warnings.length}
      <p class="warning-banner">{warnings.join(" ")}</p>
    {/if}

    {#if plugin}
      <div class="preview">
        <p>
          <strong>{plugin.name}</strong>
          <span class="mono text-muted">{plugin.id}</span>
        </p>
        <p class="hint text-muted">
          {#if plugin.builtin}
            Built-in settings · Timeout {plugin.timeoutMs ?? 5000} ms ·
            {Object.keys(plugin.settings ?? {}).length} settings · no code
          {:else}
            API {plugin.api ?? 1}{#if plugin.version}
              · v{plugin.version}{/if} · Timeout {plugin.timeoutMs ?? 5000} ms ·
            {#if plugin.code?.trim()}
              Code {plugin.code.length} bytes
            {:else}
              no code
            {/if}
            · {plugin.settingsSchema?.length ?? 0} settings fields ·
            {plugin.help ? "help" : "no help"} · {plugin.usage
              ? "usage"
              : "no usage"}{#if contributionCount(plugin) > 0}
              · {contributionCount(plugin)} contribution items{/if}
          {/if}
        </p>
      </div>
    {/if}

    {#if !plugin?.builtin}
      <p class="warning-banner">
        The imported plugin is added switched off. Enable it here when you are
        ready; the code is written to the iHome file space.
      </p>
    {/if}

    {#if plugin && contributionCount(plugin) > 0}
      <p class="warning-banner">
        This plugin adds {contributionCount(plugin)} template or example items. Applying
        one runs its logic or HTML in your pages; the plugin must stay installed for
        its entries to remain available.
      </p>
    {/if}

    <div class="actions">
      <button
        type="button"
        class="btn example"
        disabled={busy}
        onclick={loadExample}
      >
        <span class="material-symbols-outlined">lightbulb</span> NUT example
      </button>
      <button type="button" class="btn" disabled={busy} onclick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={busy || !plugin}
        onclick={confirm}
      >
        Import
      </button>
    </div>
  </div>
</div>

{#if missingStates.length}
  <ConfirmModal
    title="Create missing states?"
    confirmLabel="Create and install"
    onConfirm={() => {
      const value = plugin;
      missingStates = [];
      if (value) void doImport(value);
    }}
    onCancel={() => (missingStates = [])}
  >
    <p class="text-muted">
      These declared states do not exist on this instance yet. The plugin owns
      them; install will create the state objects with their definitions. State
      values are not part of the plugin.
    </p>
    <ul class="missing-states">
      {#each missingStates as stateId (stateId)}
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
        .then(() => onImported())
        .catch((failure) => {
          error = failure instanceof Error ? failure.message : String(failure);
        });
    }}
  />
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.5);
  }

  .modal-card {
    width: min(34rem, 100%);
    max-height: 90vh;
    overflow-y: auto;
    padding: 1rem;
  }

  .missing-states {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0.75rem 0;
  }

  .preview {
    margin: 0.5rem 0;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--surface-container-low);
  }

  .preview p {
    margin: 0;
  }

  .warning-banner {
    margin: 0.75rem 0;
    padding: 0.5rem 0.65rem;
    border-left: 3px solid var(--warning-color);
    border-radius: var(--border-radius);
    background: var(--surface-container-low);
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .example {
    margin-right: auto;
  }
</style>
