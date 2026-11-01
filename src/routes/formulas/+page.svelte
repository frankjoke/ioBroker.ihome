<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import {
    getFormulas,
    upsertFormula,
    deleteFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import type { FormulaTemplate } from "$lib/types/device";

  let editing = $state<FormulaTemplate | null>(null);
  let pendingDelete = $state<FormulaTemplate | null>(null);
  let search = $state("");
  let sortBy = $state<"name" | "unit">("name");
  let sortDir = $state<"asc" | "desc">("asc");

  const formulas = $derived(getFormulas());

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? formulas.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.expr ?? "").toLowerCase().includes(q),
        )
      : [...formulas];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort(
      (a, b) =>
        dir *
        String(sortBy === "name" ? a.name : (a.unit ?? "")).localeCompare(
          String(sortBy === "name" ? b.name : (b.unit ?? "")),
        ),
    );
  });

  /** The rows to draw: the filtered list, with the draft in place of its entry. */
  const rows = $derived.by(() => {
    if (!editing) return shown;
    const list = shown.map((t) => (t.id === editing.id ? editing : t));
    return shown.some((t) => t.id === editing.id) ? list : [editing, ...list];
  });
  const storedTemplate = $derived(
    editing ? (formulas.find((t) => t.id === editing.id) ?? null) : null,
  );
  const dirty = $derived(
    !!editing &&
      (!storedTemplate ||
        JSON.stringify(editing) !== JSON.stringify(storedTemplate)),
  );
  /** A row picked while the open draft was dirty. */
  let pendingTemplate = $state<FormulaTemplate | null>(null);
  let askClose = $state(false);

  function requestOpen(t: FormulaTemplate) {
    if (editing?.id === t.id) {
      requestClose();
      return;
    }
    if (dirty) {
      pendingTemplate = t;
      askClose = true;
      return;
    }
    startEdit(t);
  }

  function requestClose() {
    if (dirty) {
      pendingTemplate = null;
      askClose = true;
      return;
    }
    editing = null;
  }

  function onLineClick(event: MouseEvent, t: FormulaTemplate) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    requestOpen(t);
  }

  function startAdd() {
    editing = { id: newId(), name: "", expr: "" };
  }
  function startEdit(t: FormulaTemplate) {
    editing = { ...t };
  }
  function save() {
    if (!editing) return;
    upsertFormula({ ...editing, name: editing.name.trim() || "Untitled" });
    saveFormulas();
    editing = null;
  }
  function confirmDelete() {
    if (pendingDelete) {
      deleteFormula(pendingDelete.id);
      saveFormulas();
    }
    pendingDelete = null;
  }
</script>

<svelte:head>
  <title>Formula Templates - iHome</title>
</svelte:head>

<div class="formulas-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>Formula Templates</h1>
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!!editing}
        onclick={startAdd}
      >
        <span class="material-symbols-outlined">add</span> Add template
      </button>
    </div>
  </div>

  {#if formulas.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No templates yet — add one to get started.</p>
    </div>
  {:else}
    <div class="filter-bar">
      <input
        type="search"
        placeholder="Search name or expression…"
        bind:value={search}
      />
      <select bind:value={sortBy} aria-label="Sort by">
        <option value="name">Name</option>
        <option value="unit">Unit</option>
      </select>
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
      <div class="formula-list">
        {#each rows as t (t.id)}
          {@const open = editing?.id === t.id}
          <div class="item" class:open>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="item-line" onclick={(e) => onLineClick(e, t)}>
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
                  onclick={() => requestOpen(t)}
                >
                  {t.name}
                </button>
              {/if}
              {#if !open}
                <code class="formula-expr">{t.expr}</code>
              {/if}
              {#if t.unit}<span class="text-muted">{t.unit}</span>{/if}
              {#if t.notes}<span class="hint text-muted">{t.notes}</span>{/if}
              <span class="item-actions">
                {#if open}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={!dirty}
                    onclick={save}>Save</button
                  >
                {/if}
                {#if !(open && !storedTemplate)}
                  <IconButton
                    icon="delete"
                    danger
                    label={`Delete ${t.name}`}
                    onclick={() => (pendingDelete = t)}
                  />
                {/if}
              </span>
            </div>
            {#if open && editing}
              <div class="item-editor">
                <label class="field"
                  ><span class="label-mono">Expression</span>
                  <textarea rows="3" class="mono" bind:value={editing.expr}
                  ></textarea></label
                >
                <div class="form-grid">
                  <label class="field"
                    ><span class="label-mono">Unit</span>
                    <input type="text" bind:value={editing.unit} /></label
                  >
                  <label class="field"
                    ><span class="label-mono">Precision</span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={editing.precision ?? ""}
                      oninput={(e) =>
                        (editing.precision =
                          e.currentTarget.value === ""
                            ? undefined
                            : Number(e.currentTarget.value))}
                    /></label
                  >
                </div>
                <label class="field"
                  ><span class="label-mono">Notes</span>
                  <input type="text" bind:value={editing.notes} /></label
                >
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
      <p>Devices keep their copy.</p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .formulas-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 640px;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 2fr 1fr auto;
    gap: 0.5rem;
  }

  .filter-bar input,
  .filter-bar select {
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

  .formula-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .formula-expr {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40ch;
  }

  .hint {
    font-size: var(--body-sm);
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .field input {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
</style>
