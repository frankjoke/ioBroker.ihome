<script lang="ts">
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import PluginSettingsForm from "./PluginSettingsForm.svelte";
  import { deletePlugin, savePlugin } from "$lib/stores/plugins.svelte";
  import type { PluginPatch, PluginView } from "$adapter/plugin-admin";

  let {
    plugin,
    onSaved,
    onDeleted,
  }: {
    plugin: PluginView;
    onSaved: () => void;
    onDeleted: () => void;
  } = $props();

  // Drafts: the page keys this editor by plugin id, so one initial read is
  // exactly what a form wants here.
  // svelte-ignore state_referenced_locally
  let name = $state(plugin.name);
  // svelte-ignore state_referenced_locally
  let timeoutMs = $state(plugin.timeoutMs);
  // svelte-ignore state_referenced_locally
  let help = $state(plugin.help ?? "");
  // svelte-ignore state_referenced_locally
  let usage = $state(plugin.usage ?? "");
  // svelte-ignore state_referenced_locally
  let settings = $state<Record<string, unknown>>({
    ...defaults(plugin.settingsSchema, plugin.settings),
  });
  let busy = $state(false);
  let error = $state("");
  let settingsValid = $state(true);
  let confirmDelete = $state(false);

  // One snapshot for the dirty check; the form never updates it.
  const initial = (() => ({
    name,
    timeoutMs,
    help,
    usage,
    settings: JSON.stringify(settings),
  }))();
  const dirty = $derived(
    name !== initial.name ||
      timeoutMs !== initial.timeoutMs ||
      help !== initial.help ||
      usage !== initial.usage ||
      JSON.stringify(settings) !== initial.settings,
  );

  function defaults(
    schema: PluginView["settingsSchema"],
    values: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const def of schema ?? []) {
      if (def.default !== undefined) next[def.name] = def.default;
    }
    return { ...next, ...(values ?? {}) };
  }

  async function save(): Promise<void> {
    error = "";
    if (busy || !settingsValid) return;
    busy = true;
    const patch: PluginPatch = {
      id: plugin.id,
      timeoutMs,
      settings,
    };
    if (!plugin.builtin) {
      patch.name = name.trim();
      patch.help = help.trim();
      patch.usage = usage.trim();
    }
    try {
      await savePlugin(patch);
      onSaved();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    confirmDelete = false;
    error = "";
    if (busy) return;
    busy = true;
    try {
      await deletePlugin(plugin.id);
      onDeleted();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<section class="plugin-editor card">
  {#if plugin.usage}
    <div class="plugin-usage">
      <span class="label-mono">Usage</span>
      <HelpSection help={plugin.usage} static plain />
    </div>
  {/if}

  {#if plugin.restartRequired}
    <p class="restart hint">
      Restart iHome in Admin to apply this change.
      <a href="#/admin">Open Admin</a>.
    </p>
  {/if}

  <div class="fields">
    {#if !plugin.builtin}
      <label class="field">
        <span class="label-mono">Name</span>
        <input type="text" bind:value={name} />
      </label>
    {/if}
    <label class="field">
      <span class="label-mono">Default timeout (ms)</span>
      <input type="number" min="100" max="30000" bind:value={timeoutMs} />
      <span class="hint text-muted"
        >Maximum time a plugin call may take. Some plugins accept their own
        timeout option.</span
      >
    </label>
  </div>

  {#if plugin.settingsSchema?.length || Object.keys(settings).length > 0}
    <PluginSettingsForm
      schema={plugin.settingsSchema}
      bind:values={settings}
      bind:valid={settingsValid}
    />
  {/if}

  <div class="call-examples">
    <span class="label-mono">Call it from a logic</span>
    <pre><code
        >{`call("${plugin.id}", options, (data, error) => {
  if (error) return;
  // use data
});`}</code
      ></pre>
    <span class="label-mono">Call it from an HTML tile</span>
    <pre><code>{`await ihome.call("${plugin.id}", options);`}</code></pre>
  </div>

  {#if !plugin.builtin}
    <div class="fields">
      <label class="field">
        <span class="label-mono">Help (Markdown)</span>
        <textarea rows="4" bind:value={help}></textarea>
      </label>
      <label class="field">
        <span class="label-mono">Usage (Markdown)</span>
        <textarea rows="4" bind:value={usage}></textarea>
      </label>
    </div>
    <p class="hint text-muted">
      Plugin file: {plugin.codeLength} bytes (imported). Export to change it outside
      iHome.
    </p>
  {:else}
    <p class="hint text-muted">
      Export contains this built-in's settings only; no code.
    </p>
  {/if}

  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}

  <div class="actions">
    {#if !plugin.builtin}
      <button
        type="button"
        class="btn btn-danger"
        disabled={busy}
        onclick={() => (confirmDelete = true)}
      >
        Delete
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-primary"
      disabled={busy || !settingsValid || !dirty}
      onclick={save}
    >
      Save
    </button>
  </div>
</section>

{#if confirmDelete}
  <ConfirmModal
    title={`Delete ${plugin.name}?`}
    confirmLabel="Delete"
    cancelLabel="Keep"
    onConfirm={remove}
    onCancel={() => (confirmDelete = false)}
  />
{/if}

<style>
  .plugin-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .plugin-usage {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: -0.25rem 0 0;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .call-examples {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .call-examples pre {
    margin: 0 0 0.25rem;
    padding: 0.5rem;
    overflow-x: auto;
    border-radius: var(--border-radius);
    background: var(--surface-container-high);
    font-size: var(--body-sm);
  }

  .restart {
    margin: 0;
    color: var(--warning-color);
  }

  .restart a {
    color: inherit;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-danger {
    margin-right: auto;
  }
</style>
