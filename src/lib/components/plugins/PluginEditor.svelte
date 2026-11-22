<script lang="ts">
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import SchemaSettingsEditor from "$lib/components/settings/SchemaSettingsEditor.svelte";
  import {
    getPluginsVersion,
    reloadPlugin,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import {
    ensurePluginContributions,
    getPluginContributions,
    pluginContributionsProblem,
  } from "$lib/stores/plugin-contributions.svelte";
  import {
    pluginEditorTabs,
    pluginShowsTimeout,
  } from "$lib/config/plugin-editor";
  import { savePluginManifest } from "$lib/config/plugin-storage";
  import { isLocalUi } from "$lib/config/session-locality.svelte";
  import { objectProblem } from "$lib/config/schema-values";
  import {
    META_ADAPTER,
    readMetaText,
    verifiedWrite,
  } from "$lib/config/meta-files";
  import type { PluginPatch, PluginView } from "$adapter/plugin-admin";
  import {
    pluginContributionsOf,
    type PluginContributions,
  } from "$adapter/plugin-ops";

  let {
    plugin,
    dirty = $bindable(false),
    valid = $bindable(true),
    onSaved,
    onEditCollection,
  }: {
    plugin: PluginView;
    dirty?: boolean;
    valid?: boolean;
    onSaved: () => void;
    onEditCollection?: (id: string) => void;
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
  // The manifest's contributions are read once per plugin as JSON text.
  let contributionsText = $state("");
  let initialContributions = $state<string | null>(null);
  let contributionsError = $state("");
  let copiedSnippet = $state("");
  let collectionItems = $state<{
    states: string[];
    logics: string[];
    tiles: string[];
    uses: string[];
  } | null>(null);
  let collectionLoading = $state(false);
  let collectionFor = "";
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
  const tabs = $derived(pluginEditorTabs(plugin));
  const schemaProblem = $derived(
    plugin.settingsSchema?.length
      ? objectProblem({ fields: plugin.settingsSchema }, settings)
      : null,
  );

  $effect(() => {
    valid = editorValid && !schemaProblem && !contributionsError;
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

  let contributionsFor = "";
  $effect(() => {
    if (plugin.builtin || contributionsFor === plugin.id) return;
    contributionsFor = plugin.id;
    let live = true;
    void readMetaText(META_ADAPTER, `plugins/${plugin.id}/plugin.json`).then(
      (text) => {
        if (!live) return;
        let value = "";
        try {
          const raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          if (raw.contributions && typeof raw.contributions === "object") {
            value = JSON.stringify(raw.contributions, null, 2);
          }
        } catch {
          value = "";
        }
        contributionsText = value;
        initialContributions = value;
      },
    );
    return () => {
      live = false;
    };
  });

  $effect(() => {
    getPluginsVersion();
    void ensurePluginContributions();
  });

  /** The Collection tab reads its ids from the manifest on each activation: a
   *  page round-trip (Open Logic and back) must not leave a stale/empty list. */
  async function loadCollectionItems(): Promise<void> {
    collectionLoading = true;
    try {
      const text = await readMetaText(
        META_ADAPTER,
        `plugins/${plugin.id}/plugin.json`,
      );
      const raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      const owned = raw.collection as
        | {
            states?: { id?: unknown }[];
            logics?: { id?: unknown }[];
            uses?: unknown[];
          }
        | undefined;
      const tiles = Array.isArray(
        (raw.contributions as { tiles?: { id?: unknown }[] } | undefined)
          ?.tiles,
      )
        ? ((raw.contributions as { tiles?: { id?: unknown }[] }).tiles ?? [])
            .map((entry) => String(entry.id ?? ""))
            .filter(Boolean)
        : [];
      collectionItems = owned
        ? {
            states: (owned.states ?? [])
              .map((entry) => String(entry.id ?? ""))
              .filter(Boolean),
            logics: (owned.logics ?? [])
              .map((entry) => String(entry.id ?? ""))
              .filter(Boolean),
            tiles,
            uses: (owned.uses ?? [])
              .map((entry) => String(entry))
              .filter(Boolean),
          }
        : null;
    } catch {
      collectionItems = null;
    } finally {
      collectionLoading = false;
    }
  }

  $effect(() => {
    if (activeTab !== "collection" || plugin.builtin) {
      collectionFor = "";
      return;
    }
    const key = `${plugin.id}@${plugin.version ?? ""}`;
    if (collectionFor === key) return;
    collectionFor = key;
    void loadCollectionItems();
  });

  const snippets = $derived(
    getPluginContributions(true).snippets.filter(
      (entry) => entry.plugin.id === plugin.id,
    ),
  );
  const contributionProblems = $derived(
    [
      pluginContributionsProblem(),
      ...getPluginContributions(true).problems,
    ].filter(Boolean),
  );

  $effect(() => {
    if (initialContributions === null) return;
    const text = contributionsText.trim();
    if (!text || contributionsText === initialContributions) {
      contributionsError = "";
      return;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const check = pluginContributionsOf(parsed);
      contributionsError =
        "problem" in check ? `Contributions are invalid: ${check.problem}` : "";
    } catch {
      contributionsError = "Contributions must be valid JSON.";
    }
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
      (initialCode !== null && code !== initialCode) ||
      (initialContributions !== null &&
        contributionsText !== initialContributions),
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

  async function copySnippet(code: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      copiedSnippet = key;
      setTimeout(() => {
        if (copiedSnippet === key) copiedSnippet = "";
      }, 1500);
    } catch {
      /* the clipboard may be blocked on plain http */
    }
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
    const contributionsChanged =
      !plugin.builtin &&
      initialContributions !== null &&
      contributionsText !== initialContributions;
    let contributions: PluginContributions | null | undefined;
    if (contributionsChanged) {
      const text = contributionsText.trim();
      if (!text) {
        contributions = null;
      } else {
        try {
          contributions = JSON.parse(text) as PluginContributions;
        } catch {
          error = "Contributions must be valid JSON.";
          return;
        }
      }
    }
    busy = true;
    const manifestChanged =
      !plugin.builtin &&
      (nextName !== initial.name ||
        help.trim() !== initial.help ||
        usage.trim() !== initial.usage ||
        contributionsChanged);
    const codeChanged =
      !plugin.builtin && initialCode !== null && code !== initialCode;
    if (codeChanged && !code.trim()) {
      error = "A plugin needs code.";
      busy = false;
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
          ...(contributionsChanged ? { contributions } : {}),
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
    {#if plugin.restartRequired}
      <p class="restart hint">
        Restart iHome in Admin to apply this change.
        <a href="#/admin">Open Admin</a>.
      </p>
    {/if}
    {#if plugin.warnings?.length}
      <p class="hint text-warning">{plugin.warnings.join(" ")}</p>
    {/if}

    <div class="fields">
      {#if !plugin.builtin}
        <label class="field">
          <span class="label-mono">Name</span>
          <input type="text" bind:value={name} />
        </label>
      {/if}
      {#if pluginShowsTimeout(plugin)}
        <label class="field">
          <span class="label-mono">Default timeout (ms)</span>
          <input type="number" min="100" max="30000" bind:value={timeoutMs} />
          <span class="hint text-muted"
            >Maximum time a plugin call may take. Some plugins accept their own
            timeout option.</span
          >
        </label>
      {/if}
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
    {#if snippets.length}
      <div class="call-examples">
        <span class="label-mono">Examples from this plugin</span>
        {#each snippets as snippet (snippet.key)}
          <p class="hint text-muted">
            <strong>{snippet.value.name}</strong>
            {#if snippet.value.language}
              <span class="badge">{snippet.value.language}</span>
            {/if}
            {#if snippet.value.description}
              — {snippet.value.description}
            {/if}
          </p>
          <pre><code>{snippet.value.code}</code></pre>
          <button
            type="button"
            class="btn btn-sm"
            onclick={() => void copySnippet(snippet.value.code, snippet.key)}
          >
            <span class="material-symbols-outlined">content_copy</span>
            {copiedSnippet === snippet.key ? "Copied." : "Copy"}
          </button>
        {/each}
      </div>
    {/if}
  {:else if activeTab === "contributions"}
    {#if plugin.contributions}
      <p class="hint text-muted">
        {plugin.contributions.total} contributed item(s):
        {Object.entries(plugin.contributions.counts)
          .map(([kind, count]) => `${count} ${kind}`)
          .join(", ")}.
      </p>
    {/if}
    <p class="hint text-muted">
      <a href={`#/templates?plugin=${encodeURIComponent(plugin.id)}`}
        >View in Templates</a
      >
    </p>
    {#if contributionProblems.length}
      <p class="text-danger hint">{contributionProblems.join(" ")}</p>
    {/if}
    <label class="field">
      <span class="label-mono">Contributions (JSON)</span>
      <textarea
        class="mono plugin-code"
        rows="12"
        spellcheck="false"
        bind:value={contributionsText}
      ></textarea>
    </label>
    {#if contributionsError}
      <p class="text-danger hint">{contributionsError}</p>
    {/if}
    <p class="hint text-muted">
      Tiles, bundles, logic, formulas, functions and copyable snippets this
      plugin offers. The adapter validates ids, sizes and the envelope when you
      save; applying a template creates your own copy.
    </p>
  {:else if activeTab === "collection"}
    <p class="hint text-muted">
      This plugin owns {plugin.collection?.states ?? 0} state(s),
      {plugin.collection?.logics ?? 0} logic,
      {plugin.collection?.tiles ?? 0} tile(s) and uses
      {plugin.collection?.uses ?? 0} external state(s). The plugin lifecycle enables
      and disables the owned logic; state values are never captured.
    </p>
    {#if collectionLoading && !collectionItems}
      <p class="hint text-muted">Loading collection…</p>
    {:else if collectionItems}
      {#if collectionItems.states.length}
        <p class="label-mono">States</p>
        <p class="hint text-muted mono">{collectionItems.states.join(", ")}</p>
      {/if}
      {#if collectionItems.logics.length}
        <p class="label-mono">Logic</p>
        <p class="hint text-muted mono">{collectionItems.logics.join(", ")}</p>
      {/if}
      {#if collectionItems.uses.length}
        <p class="label-mono">Uses</p>
        <p class="hint text-muted mono">{collectionItems.uses.join(", ")}</p>
      {/if}
      {#if collectionItems.tiles.length}
        <p class="label-mono">Tiles</p>
        <p class="hint text-muted mono">{collectionItems.tiles.join(", ")}</p>
      {/if}
    {:else}
      <p class="hint text-muted">The plugin manifest is unreadable.</p>
    {/if}
    <div class="collection-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={busy}
        onclick={() => onEditCollection?.(plugin.id)}
      >
        Save as new version
      </button>
      <a class="btn btn-sm" href="#/logic">Open Logic</a>
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

  .collection-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .restart a {
    color: inherit;
  }
</style>
