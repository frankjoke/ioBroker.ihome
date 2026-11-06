<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import {
    deleteFunction,
    functionSaveFailed,
    getFunctions,
    isFunctionsWritable,
    upsertFunction,
  } from "$lib/stores/functions.svelte";
  import { saveFunctions } from "$lib/functions.svelte.js";
  import { functionTemplateProblem } from "$lib/config/functions";
  import type { FunctionTemplate } from "$lib/types/device";

  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  let editing = $state<FunctionTemplate | null>(null);
  let pendingDelete = $state<FunctionTemplate | null>(null);
  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");

  const functions = $derived(getFunctions());
  const writable = $derived(isFunctionsWritable());
  const saveFailed = $derived(functionSaveFailed());
  const problem = $derived(editing ? functionTemplateProblem(editing) : null);

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? functions.filter(
          (template) =>
            template.name.toLowerCase().includes(q) ||
            template.code.toLowerCase().includes(q),
        )
      : [...functions];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => dir * a.name.localeCompare(b.name));
  });

  const rows = $derived.by(() => {
    if (!editing) return shown;
    const list = shown.map((template) =>
      template.id === editing!.id ? editing! : template,
    );
    return shown.some((template) => template.id === editing!.id)
      ? list
      : [editing, ...list];
  });
  const stored = $derived(
    editing
      ? (functions.find((template) => template.id === editing!.id) ?? null)
      : null,
  );
  const isDirty = $derived(
    !!editing &&
      (!stored || JSON.stringify(editing) !== JSON.stringify(stored)),
  );
  $effect(() => {
    dirty = isDirty;
  });

  let pendingTemplate = $state<FunctionTemplate | null>(null);
  let askClose = $state(false);

  function requestOpen(template: FunctionTemplate) {
    if (editing?.id === template.id) {
      requestClose();
      return;
    }
    if (isDirty) {
      pendingTemplate = template;
      askClose = true;
      return;
    }
    startEdit(template);
  }

  function requestClose() {
    if (isDirty) {
      pendingTemplate = null;
      askClose = true;
      return;
    }
    editing = null;
  }

  function startAdd() {
    editing = { id: newId(), name: "", mode: "expression", code: "" };
  }

  function startEdit(template: FunctionTemplate) {
    editing = { ...template };
  }

  function save() {
    if (!editing || problem || !writable) return;
    upsertFunction({ ...editing, name: editing.name.trim() || "Untitled" });
    saveFunctions();
    editing = null;
  }

  function confirmDelete() {
    if (pendingDelete && writable) {
      deleteFunction(pendingDelete.id);
      saveFunctions();
    }
    pendingDelete = null;
  }
</script>

<div class="function-templates">
  <div class="page-header">
    <div class="page-heading">
      <h2>Function templates</h2>
      <p class="text-muted hint">
        Code snippets for formula, action and function fields.
      </p>
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!!editing}
        onclick={startAdd}
      >
        <span class="material-symbols-outlined">add</span> Template
      </button>
    </div>
  </div>

  {#if !writable}
    <p class="text-danger hint">
      Function templates could not be loaded — saving is disabled so the stored
      list is not overwritten.
    </p>
  {:else if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}

  {#if functions.length === 0 && !editing}
    <div class="card empty-state">
      <p class="text-muted">No function templates yet — add one.</p>
    </div>
  {:else}
    <div class="filter-bar">
      <input
        type="search"
        placeholder="Search name or code…"
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

    {#if shown.length === 0 && !editing}
      <div class="card empty-state">
        <p class="text-muted">No templates match the search.</p>
      </div>
    {:else}
      <div class="function-list">
        {#each rows as template (template.id)}
          {@const open = editing?.id === template.id}
          <div class="item" class:open>
            <div class="item-line">
              {#if open && editing}
                <input
                  class="name-input"
                  value={editing.name}
                  placeholder="New template"
                  aria-label="Template name"
                  oninput={(e) => {
                    if (editing) editing.name = e.currentTarget.value;
                  }}
                />
              {:else}
                <button
                  type="button"
                  class="name"
                  onclick={() => requestOpen(template)}
                >
                  {template.name}
                </button>
              {/if}
              <span class="mode">{template.mode}</span>
              {#if !open}
                <code class="code">{template.code}</code>
              {/if}
              <span class="item-actions">
                {#if open}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={!isDirty || !!problem || !writable}
                    onclick={save}>Save</button
                  >
                {/if}
                {#if !(open && !stored)}
                  <IconButton
                    icon="delete"
                    danger
                    label={`Delete ${template.name}`}
                    onclick={() => (pendingDelete = template)}
                  />
                {/if}
              </span>
            </div>

            {#if open && editing}
              <div class="item-editor">
                <div class="form-grid">
                  <label class="field"
                    ><span class="label-mono">Mode</span>
                    <select bind:value={editing.mode}>
                      <option value="expression">Expression</option>
                      <option value="statements">Statements</option>
                    </select></label
                  >
                  <label class="field"
                    ><span class="label-mono">Description</span>
                    <input
                      type="text"
                      bind:value={editing.description}
                    /></label
                  >
                </div>
                <label class="field"
                  ><span class="label-mono">Code</span>
                  <textarea rows="6" class="mono" bind:value={editing.code}
                  ></textarea></label
                >
                {#if problem}
                  <p class="text-danger hint">{problem}</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if askClose}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => {
        askClose = false;
        const next = pendingTemplate;
        pendingTemplate = null;
        if (next) startEdit(next);
        else editing = null;
      }}
      onCancel={() => {
        askClose = false;
        pendingTemplate = null;
      }}
    />
  {/if}

  {#if pendingDelete}
    <ConfirmModal
      title={deleteTitle("template", pendingDelete.name)}
      confirmLabel="Delete"
      onConfirm={confirmDelete}
      onCancel={() => (pendingDelete = null)}
    >
      <p>Controls keep their inserted code.</p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .function-templates {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 640px;
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

  .page-actions {
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

  .function-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .item {
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
  }

  .item.open {
    border-color: var(--primary-color);
  }

  .item-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.55rem;
    min-width: 0;
  }

  .name {
    border: 0;
    background: transparent;
    color: var(--text-color);
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    text-align: left;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-input {
    flex: 1;
    min-width: 0;
  }

  .mode {
    font-size: var(--body-sm);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
    white-space: nowrap;
  }

  .code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .item-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }

  .item-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.55rem 0.55rem;
  }
</style>
