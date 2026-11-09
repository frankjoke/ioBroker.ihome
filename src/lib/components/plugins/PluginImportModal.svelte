<script lang="ts">
  import { importPlugin } from "$lib/stores/plugins.svelte";
  import { parsePluginFile, type ImportedPlugin } from "$adapter/plugin-file";

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
  let busy = $state(false);

  async function choose(event: Event): Promise<void> {
    error = "";
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
  }

  async function confirm(): Promise<void> {
    if (!plugin || busy) return;
    error = "";
    busy = true;
    try {
      await importPlugin(plugin);
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
        Choose an iHome plugin file. The plugin stays switched off until you
        restart iHome in Admin and enable it here.
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
            Timeout {plugin.timeoutMs ?? 5000} ms · Code {plugin.code.length}
            bytes · {plugin.settingsSchema?.length ?? 0} settings fields ·
            {plugin.help ? "help" : "no help"} · {plugin.usage
              ? "usage"
              : "no usage"}
          {/if}
        </p>
      </div>
    {/if}

    {#if !plugin?.builtin}
      <p class="warning-banner">
        The imported plugin stays switched off. Restart iHome in Admin, then
        enable it here.
      </p>
    {/if}

    <div class="actions">
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
</style>
