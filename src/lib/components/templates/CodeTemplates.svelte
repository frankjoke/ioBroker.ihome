<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { BUILTIN_FUNCTIONS } from "$lib/config/function-presets";
  import {
    codeEntries,
    filterCodeEntries,
    type CodeEntry,
  } from "$lib/config/code-entries";
  import {
    deleteFormula,
    getFormulas,
    upsertFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import {
    deleteFunction,
    functionSaveFailed,
    getFunctions,
    isFunctionsWritable,
    upsertFunction,
  } from "$lib/stores/functions.svelte";
  import { saveFunctions } from "$lib/functions.svelte.js";
  import FormulaEditor from "./FormulaEditor.svelte";
  import FunctionEditor from "./FunctionEditor.svelte";
  import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";

  let {
    formulaOnly = false,
    dirty = $bindable(false),
  }: { formulaOnly?: boolean; dirty?: boolean } = $props();

  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let selected = $state<CodeEntry | null>(null);
  let draftKind = $state<"formula" | "function">("formula");
  let draft = $state<FormulaTemplate | FunctionTemplate | null>(null);
  let editorDirty = $state(false);
  let editorProblem = $state<string | null>(null);
  let editorRef = $state<{ save: () => void } | null>(null);
  let pendingAction: (() => void) | null = null;
  let askClose = $state(false);
  let pendingDelete = $state<CodeEntry | null>(null);
  let error = $state("");

  const formulas = $derived(getFormulas());
  const functions = $derived(getFunctions());
  const saveFailed = $derived(functionSaveFailed());
  const entries = $derived(
    codeEntries(
      formulas,
      formulaOnly ? [] : functions,
      formulaOnly ? [] : BUILTIN_FUNCTIONS,
    ),
  );
  const shown = $derived(filterCodeEntries(entries, search, sortDir));
  const rows = $derived.by(() => {
    if (!selected) return shown;
    const exists = shown.some(
      (entry) => entry.kind === selected.kind && entry.id === selected.id,
    );
    return exists
      ? shown.map((entry) =>
          entry.kind === selected.kind && entry.id === selected.id
            ? selected
            : entry,
        )
      : [selected, ...shown];
  });

  function isOpen(entry: CodeEntry) {
    return selected?.kind === entry.kind && selected?.id === entry.id;
  }

  function onLineClick(event: MouseEvent, entry: CodeEntry) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label")) return;
    open(entry);
  }

  $effect(() => {
    dirty = editorDirty;
  });

  const isNew = $derived.by(() => {
    if (!draft) return false;
    return draftKind === "formula"
      ? !formulas.some((template) => template.id === draft!.id)
      : !functions.some((template) => template.id === draft!.id);
  });

  function guard(action: () => void) {
    if (editorDirty) {
      pendingAction = action;
      askClose = true;
      return;
    }
    action();
  }

  function closeNow() {
    selected = null;
    draft = null;
    editorDirty = false;
    editorProblem = null;
  }

  function start(entry: CodeEntry) {
    if (entry.kind === "formula") {
      const template = formulas.find((item) => item.id === entry.id);
      if (!template) return;
      draftKind = "formula";
      draft = { ...template };
    } else {
      const builtin = BUILTIN_FUNCTIONS.find((item) => item.id === entry.id);
      const user = functions.find((item) => item.id === entry.id);
      const template = user ?? builtin;
      if (!template) return;
      draftKind = "function";
      draft = builtin
        ? { ...builtin, id: newId(), name: `${builtin.name} copy` }
        : { ...template };
    }
    selected = entry;
    editorDirty = false;
    editorProblem = null;
  }

  function open(entry: CodeEntry) {
    if (selected?.id === entry.id && selected?.kind === entry.kind) {
      guard(closeNow);
      return;
    }
    guard(() => start(entry));
  }

  function startNew(kind: "formula" | "function") {
    if (kind === "formula") {
      draftKind = "formula";
      const template = { id: newId(), name: "", expr: "" };
      draft = template;
      selected = {
        kind: "formula",
        id: template.id,
        name: "New formula",
        preview: "",
        builtin: false,
        search: "",
      };
    } else {
      draftKind = "function";
      const template: FunctionTemplate = {
        id: newId(),
        name: "",
        mode: "expression",
        code: "",
      };
      draft = template;
      selected = {
        kind: "function",
        id: template.id,
        name: "New snippet",
        preview: "",
        builtin: false,
        search: "",
      };
    }
    editorDirty = false;
    editorProblem = null;
  }

  function save(template: FormulaTemplate | FunctionTemplate) {
    error = "";
    if (draftKind === "formula") {
      upsertFormula(template as FormulaTemplate);
      saveFormulas();
    } else {
      if (!isFunctionsWritable()) {
        error =
          "Function templates could not be loaded — the change was not saved.";
        return;
      }
      upsertFunction(template as FunctionTemplate);
      saveFunctions();
    }
    closeNow();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    error = "";
    if (pendingDelete.kind === "formula") {
      deleteFormula(pendingDelete.id);
      saveFormulas();
    } else {
      if (!isFunctionsWritable()) {
        error =
          "Function templates could not be loaded — the delete was not saved.";
        pendingDelete = null;
        return;
      }
      deleteFunction(pendingDelete.id);
      saveFunctions();
    }
    if (
      selected?.id === pendingDelete.id &&
      selected?.kind === pendingDelete.kind
    ) {
      closeNow();
    }
    pendingDelete = null;
  }
</script>

<div class="code-templates">
  <div class="page-header">
    <div class="page-heading">
      <h1>{formulaOnly ? "Formula Templates" : "Code templates"}</h1>
      {#if !formulaOnly}
        <p class="text-muted hint">
          Formula and Function snippets used from formula, action and function
          fields.
        </p>
      {/if}
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => guard(() => startNew("formula"))}
      >
        <span class="material-symbols-outlined">add</span> Formula
      </button>
      {#if !formulaOnly}
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => guard(() => startNew("function"))}
        >
          <span class="material-symbols-outlined">add</span> Function
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}
  {#if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}

  {#if entries.length === 0 && !selected}
    <div class="card empty-state">
      <p class="text-muted">No templates yet — add one to get started.</p>
    </div>
  {:else}
    {#if entries.length > 0}
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
    {/if}

    {#if rows.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No templates match the search.</p>
      </div>
    {:else}
      <div class="code-list">
        {#each rows as entry (`${entry.kind}:${entry.id}`)}
          <div class="item" class:open={isOpen(entry)}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="item-line"
              onclick={(event) => onLineClick(event, entry)}
            >
              <button type="button" class="name" onclick={() => open(entry)}>
                {entry.name}
              </button>
              <span class="badge"
                >{entry.kind === "formula" ? "Formula" : "Function"}</span
              >
              {#if entry.builtin}
                <span class="badge">built-in</span>
              {/if}
              <code class="preview">{entry.preview}</code>
              {#if isOpen(entry) || !entry.builtin}
                <span class="item-actions">
                  {#if isOpen(entry)}
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled={!editorDirty ||
                        !!editorProblem ||
                        (draftKind === "function" && !isFunctionsWritable())}
                      onclick={() => editorRef?.save()}
                    >
                      <span class="material-symbols-outlined">check</span> Save
                    </button>
                    <IconButton
                      icon="close"
                      label="Close"
                      onclick={() => guard(closeNow)}
                    />
                  {/if}
                  {#if !entry.builtin}
                    <IconButton
                      icon="delete"
                      danger
                      label={`Delete ${entry.name}`}
                      onclick={() => (pendingDelete = entry)}
                    />
                  {/if}
                </span>
              {/if}
            </div>
            {#if isOpen(entry)}
              <div class="item-editor">
                {#if draftKind === "formula"}
                  <FormulaEditor
                    template={draft as FormulaTemplate}
                    {isNew}
                    bind:this={editorRef}
                    bind:dirty={editorDirty}
                    bind:problem={editorProblem}
                    onSave={save}
                  />
                {:else}
                  <FunctionEditor
                    template={draft as FunctionTemplate}
                    {isNew}
                    bind:this={editorRef}
                    bind:dirty={editorDirty}
                    bind:problem={editorProblem}
                    onSave={save}
                  />
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
        editorDirty = false;
        const action = pendingAction;
        pendingAction = null;
        action?.();
      }}
      onCancel={() => {
        askClose = false;
        pendingAction = null;
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
  .code-templates {
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

  .page-heading h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
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

  .code-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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

  .badge {
    font-size: var(--body-sm);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
    white-space: nowrap;
  }

  .preview {
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

  .empty-state {
    padding: 2rem;
    text-align: center;
  }
</style>
