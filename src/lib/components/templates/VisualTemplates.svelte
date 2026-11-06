<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { PRESETS } from "$lib/config/presets";
  import { parseTemplateRegistry } from "$lib/config/template-ops";
  import {
    commitTemplates,
    getTemplateRegistry,
  } from "$lib/stores/templates.svelte.js";
  import type { Template } from "$lib/types/display";

  const registry = $derived(getTemplateRegistry());
  const presets = Object.values(PRESETS);
  const presetIds = new Set(presets.map((template) => template.id));
  const allTemplates = $derived([
    ...presets,
    ...(registry.templates ?? []),
  ]);

  let selectedId = $state(presets[0].id);
  let json = $state("");
  let error = $state("");
  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let pendingDelete = $state<Template | null>(null);

  const selected = $derived(
    allTemplates.find((template) => template.id === selectedId) ??
      presets[0],
  );
  const isBuiltin = $derived(
    !!selected &&
      (selected.builtin === true || presetIds.has(selected.id)),
  );

  $effect(() => {
    if (!selected) return;
    json = JSON.stringify(selected, null, 2);
    error = "";
  });

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? allTemplates.filter(
          (template) =>
            template.name.toLowerCase().includes(q) ||
            template.type.toLowerCase().includes(q),
        )
      : [...allTemplates];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => dir * a.name.localeCompare(b.name));
  });

  function duplicate(): void {
    if (!selected) return;
    const copy: Template = {
      ...structuredClone($state.snapshot(selected)),
      id: newId(),
      name: `${selected.name} copy`,
      builtin: false,
      basedOn: selected.basedOn ?? selected.type,
    };
    const next = [...(registry.templates ?? []), copy];
    if (!commitTemplates({ ...registry, templates: next })) {
      error = "The template document could not be saved.";
      return;
    }
    selectedId = copy.id;
  }

  function save(): void {
    if (!selected || isBuiltin) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const checked = parseTemplateRegistry({
      version: 0,
      updatedAt: Date.now(),
      templates: [parsed],
    });
    if (!checked) {
      error = "The JSON is not a valid visual template.";
      return;
    }
    const entry = { ...checked.templates[0], builtin: false };
    const next = [
      ...(registry.templates ?? []).filter(
        (template) => template.id !== selected.id,
      ),
      entry,
    ];
    if (!commitTemplates({ ...registry, templates: next })) {
      error = "The template document could not be saved.";
      return;
    }
    selectedId = entry.id;
    error = "";
  }

  function remove(): void {
    if (!selected || isBuiltin) return;
    const next = (registry.templates ?? []).filter(
      (template) => template.id !== selected.id,
    );
    if (!commitTemplates({ ...registry, templates: next })) {
      error = "The template document could not be saved.";
      return;
    }
    selectedId = presets[0].id;
    pendingDelete = null;
  }
</script>

<div class="visual-templates">
  <div class="page-header">
    <div class="page-heading">
      <h2>Device templates</h2>
      <p class="text-muted hint">
        Visual tile/control templates. Duplicate a preset to edit it.
      </p>
    </div>
    <div class="page-actions">
      <button type="button" class="btn btn-sm" onclick={duplicate}>
        Duplicate
      </button>
    </div>
  </div>

  <div class="filter-bar">
    <input
      type="search"
      placeholder="Search name or type…"
      bind:value={search}
    />
    <button
      type="button"
      class="sort-dir"
      title="Toggle sort direction"
      aria-label="Toggle sort direction"
      onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
    >
      <span class="material-symbols-outlined"
        >{sortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span
      >
    </button>
  </div>

  {#if shown.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No templates match the search.</p>
    </div>
  {:else}
    <div class="template-list">
      {#each shown as template (template.id)}
        <button
          type="button"
          class="template-row"
          class:active={selectedId === template.id}
          onclick={() => (selectedId = template.id)}
        >
          <span class="name">{template.name}</span>
          <span class="type">{template.type}</span>
          <span class="badge">{presetIds.has(template.id) ? "built-in" : "user"}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if selected}
    <div class="editor">
      <div class="editor-head">
        <span class="label-mono">{selected.name}</span>
        {#if isBuiltin}
          <span class="hint text-muted">Built-in — duplicate to edit.</span>
        {:else}
          <span class="item-actions">
            <button type="button" class="btn btn-primary btn-sm" onclick={save}>
              Save
            </button>
            <IconButton
              icon="delete"
              danger
              label={`Delete ${selected.name}`}
              onclick={() => (pendingDelete = selected)}
            />
          </span>
        {/if}
      </div>
      <textarea
        class="json"
        rows="20"
        spellcheck="false"
        readonly={isBuiltin}
        bind:value={json}
        aria-label="Visual template JSON"
      ></textarea>
      {#if error}
        <p class="text-danger hint">{error}</p>
      {/if}
    </div>
  {/if}

  {#if pendingDelete}
    <ConfirmModal
      title={deleteTitle("template", pendingDelete.name)}
      confirmLabel="Delete"
      onConfirm={remove}
      onCancel={() => (pendingDelete = null)}
    >
      <p>Devices keep their current visual copy.</p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .visual-templates {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1 1 14rem;
    min-width: 0;
  }

  .page-heading h2 {
    margin: 0;
  }

  .page-actions,
  .item-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }

  .filter-bar input {
    min-width: 0;
    padding: 0.35rem;
  }

  .sort-dir {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .sort-dir:hover {
    background: var(--surface-container);
  }

  .sort-dir .material-symbols-outlined {
    font-size: 18px;
  }

  .template-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .template-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
    color: var(--text-color);
    cursor: pointer;
    text-align: left;
  }

  .template-row.active {
    border-color: var(--primary-color);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type,
  .badge {
    font-size: var(--body-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .badge {
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .editor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .json {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.4;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
</style>
