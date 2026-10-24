<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import {
    getFormulas,
    upsertFormula,
    deleteFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import type { FormulaTemplate } from "$lib/types/device";

  let editing = $state<FormulaTemplate | null>(null);
  let showForm = $state(false);
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

  function startAdd() {
    editing = { id: newId(), name: "", expr: "" };
    showForm = true;
  }
  function startEdit(t: FormulaTemplate) {
    editing = { ...t };
    showForm = true;
  }
  function save() {
    if (!editing) return;
    upsertFormula({ ...editing, name: editing.name.trim() || "Untitled" });
    saveFormulas();
    showForm = false;
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
        class="icon-btn primary"
        title="Add template"
        aria-label="Add template"
        disabled={showForm}
        onclick={startAdd}
      >
        <span class="material-symbols-outlined">add</span>
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
        {#each shown as t (t.id)}
          <div class="card formula-row">
            <div class="formula-main">
              <span class="formula-name">{t.name}</span>
              <code class="formula-expr">{t.expr}</code>
              {#if t.unit}<span class="text-muted">{t.unit}</span>{/if}
              {#if t.notes}<span class="hint text-muted">{t.notes}</span>{/if}
            </div>
            <div class="formula-actions">
              <button
                type="button"
                class="icon-btn"
                title="Edit"
                aria-label="Edit"
                onclick={() => startEdit(t)}
              >
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button
                type="button"
                class="icon-btn danger"
                title="Delete"
                aria-label="Delete"
                onclick={() => (pendingDelete = t)}
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if showForm && editing}
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Formula template"
    >
      <div class="modal-card card">
        <h3>{editing.name ? "Edit template" : "New template"}</h3>
        <label class="field"
          ><span class="label-mono">Name</span>
          <input type="text" bind:value={editing.name} /></label
        >
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
        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              showForm = false;
              editing = null;
            }}>Cancel</button
          >
          <button type="button" class="btn btn-primary" onclick={save}
            >Save</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if pendingDelete}
    <ConfirmModal
      title="Delete template"
      confirmLabel="Delete"
      onConfirm={confirmDelete}
      onCancel={() => (pendingDelete = null)}
    >
      <p>
        Delete <strong>{pendingDelete.name}</strong>? Devices keep their copy.
      </p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .formulas-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
    gap: 0.5rem;
  }

  .formula-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
  }

  .formula-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .formula-name {
    font-weight: 600;
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

  .formula-actions {
    display: flex;
    gap: 0.35rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--surface-container);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }

  .icon-btn.primary {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--on-primary);
  }

  .icon-btn.primary:hover {
    background: var(--primary-dark);
    border-color: var(--primary-dark);
  }

  .icon-btn.danger:hover {
    background: var(--danger-color, #c0392b);
    border-color: var(--danger-color, #c0392b);
    color: #fff;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-card {
    width: min(520px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-card h3 {
    margin: 0;
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

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
