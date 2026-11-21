<script lang="ts">
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import SchemaSettingsEditor from "$lib/components/settings/SchemaSettingsEditor.svelte";
  import { reloadPlugin, savePlugin } from "$lib/stores/plugins.svelte";
  import { savePluginManifest } from "$lib/config/plugin-storage";
  import { isLocalUi } from "$lib/config/session-locality.svelte";
  import { objectProblem } from "$lib/config/schema-values";
  import {
    META_ADAPTER,
    readMetaText,
    verifiedWrite,
  } from "$lib/config/meta-files";
  import type { PluginPatch, PluginView } from "$adapter/plugin-admin";

  let {
    plugin,
    dirty = $bindable(false),
    valid = $bindable(true),
    onSaved,
  }: {
    plugin: PluginView;
    dirty?: boolean;
    valid?: boolean;
    onSaved: () => void;
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
  let secured = $state(plugin.secured === true);
  const local = $derived(isLocalUi());
  // svelte-ignore state_referenced_locally
  let settings = $state<Record<string, unknown>>({
    ...defaults(plugin.settingsSchema, plugin.settings),
  });
  let busy = $state(false);
  let error = $state("");
  let activeTab = $state("settings");
  let editorValid = $state(true);
  // The code file is read when the editor opens; null means not loaded yet.
  let code = $state("");
  let initialCode = $state<string | null>(null);
  // The code is read once per plugin; a list refresh must not replace a draft.
  let readFor = "";

  const declaredTabs = $derived(plugin.settingsTabs ?? []);
  const ownedElsewhere = $derived(
    new Set(
      declaredTabs
        .filter((tab) => tab.id !== "settings")
        .flatMap((tab) => tab.fields),
    ),
  );
  const settingsFields = $derived(
    (plugin.settingsSchema ?? []).filter(
      (field) => !ownedElsewhere.has(field.name),
    ),
  );
  const tabs = $derived([
    { id: "settings", label: "Settings", hint: "Runtime and plugin settings" },
    ...declaredTabs
      .filter((tab) => tab.id !== "settings")
      .map((tab) => ({
        id: tab.id,
        label: tab.label,
        hint: `${tab.label} settings`,
      })),
    { id: "help", label: "Help", hint: "Setup, usage and examples" },
    ...(plugin.builtin
      ? []
      : [{ id: "code", label: "Code", hint: "Plugin code and file state" }]),
  ]);
  const schemaProblem = $derived(
    plugin.settingsSchema?.length
      ? objectProblem({ fields: plugin.settingsSchema }, settings)
      : null,
  );

  $effect(() => {
    valid = editorValid && !schemaProblem;
  });

  $effect(() => {
    if (plugin.builtin || readFor === plugin.id) return;
    readFor = plugin.id;
    let live = true;
    void readMetaText(META_ADAPTER, `plugins/${plugin.id}/index.js`).then(
      (text) => {
        if (!live) return;
        code = text ?? "";
        initialCode = code;
      },
    );
    return () => {
      live = false;
    };
  });

  // One snapshot for the dirty check; the form never updates it.
  const initial = (() => ({
    name,
    timeoutMs,
    help,
    usage,
    secured,
    settings: JSON.stringify(settings),
  }))();
  const changed = $derived(
    name !== initial.name ||
      timeoutMs !== initial.timeoutMs ||
      help !== initial.help ||
      usage !== initial.usage ||
      secured !== initial.secured ||
      JSON.stringify(settings) !== initial.settings ||
      (initialCode !== null && code !== initialCode),
  );
  $effect(() => {
    dirty = changed;
  });

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

  /** Save lives on the item's line while open, so the list calls this. */
  export async function save(): Promise<void> {
    error = "";
    if (busy || !valid || !changed) return;
    const nextName = name.trim();
    if (!plugin.builtin && !nextName) {
      error = "A plugin needs a name.";
      return;
    }
    busy = true;
    const manifestChanged =
      !plugin.builtin &&
      (nextName !== initial.name ||
        help.trim() !== initial.help ||
        usage.trim() !== initial.usage);
    const codeChanged =
      !plugin.builtin && initialCode !== null && code !== initialCode;
    if (codeChanged && !code.trim()) {
      error = "A plugin needs code.";
      return;
    }
    const patch: PluginPatch = {
      id: plugin.id,
      timeoutMs,
      settings,
      secured,
    };
    if (!plugin.builtin) {
      patch.name = nextName;
      patch.help = help.trim();
      patch.usage = usage.trim();
    }
    try {
      // The manifest file is the truth for name/help/usage; writing it first
      // means a failed write leaves the runtime entry untouched.
      if (manifestChanged) {
        await savePluginManifest(plugin.id, {
          name: nextName,
          help: help.trim(),
          usage: usage.trim(),
        });
      }
      if (codeChanged) {
        await verifiedWrite(
          META_ADAPTER,
          `plugins/${plugin.id}/index.js`,
          code,
        );
      }
      await savePlugin(patch);
      if (manifestChanged || codeChanged) await reloadPlugin(plugin.id);
      onSaved();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  function fieldsFor(tab: string) {
    return (
      plugin.settingsSchema?.filter((field) =>
        tab === "settings"
          ? !ownedElsewhere.has(field.name)
          : (
              declaredTabs.find((entry) => entry.id === tab)?.fields ?? []
            ).includes(field.name),
      ) ?? []
    );
  }
</script>

<section class="plugin-editor">
  <OptionTabs
    bind:value={activeTab}
    label={`${plugin.name} configuration`}
    {tabs}
    collapsible={false}
    showHint={false}
  />

  {#if activeTab === "settings"}
    {#if plugin.bundle}
      <p class="hint text-muted">
        Includes a device template ({plugin.bundle.device.controls.length}
        controls). Enabling creates it, or asks before updating an existing one.
      </p>
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
      {#if local}
        <label
          class="check"
          class:check-danger={secured}
          title="Hidden from the Plugins list when iHome is opened through external access (https)."
        >
          <input type="checkbox" bind:checked={secured} />
          <span>Secured</span>
        </label>
      {/if}
    </div>

    {#if plugin.settingsSchema?.length}
      {#if settingsFields.length}
        <SchemaSettingsEditor
          schema={settingsFields}
          bind:values={settings}
          bind:valid={editorValid}
        />
      {:else}
        <p class="hint text-muted">
          All plugin settings are on the other tabs.
        </p>
      {/if}
    {:else}
      <SchemaSettingsEditor bind:values={settings} bind:valid={editorValid} />
    {/if}

    {#if plugin.builtin}
      <p class="hint text-muted">
        Export contains this built-in's settings only; no code.
      </p>
    {/if}
  {:else if activeTab === "help"}
    {#if plugin.builtin}
      {#if plugin.usage}
        <HelpSection help={plugin.usage} static plain />
      {/if}
    {:else}
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
  {:else if activeTab === "code" && !plugin.builtin}
    <label class="field">
      <span class="label-mono">Code (JavaScript)</span>
      <textarea
        class="mono plugin-code"
        rows="12"
        spellcheck="false"
        bind:value={code}
      ></textarea>
    </label>
    <p class="hint text-muted">
      Stored in <span class="mono">plugins/{plugin.id}/index.js</span>; Save
      writes the file and restarts this plugin. {plugin.codeLength} bytes on disk
      now.
    </p>
  {:else}
    {@const tabFields = fieldsFor(activeTab)}
    {#if tabFields.length}
      <SchemaSettingsEditor
        schema={tabFields}
        bind:values={settings}
        bind:valid={editorValid}
      />
    {:else}
      <p class="hint text-muted">No fields.</p>
    {/if}
  {/if}

  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}
</section>

<style>
  .plugin-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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

  .plugin-code {
    min-height: 12rem;
    font-size: var(--body-sm);
    line-height: 1.45;
    tab-size: 2;
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
</style>
