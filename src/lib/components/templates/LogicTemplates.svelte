<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { BUILTIN_TEMPLATES } from "$logic/templates";
  import { logicTemplateProblem } from "$lib/config/logic-templates";
  import {
    commitLogics,
    getLogicDocument,
    isLogicsWritable,
    logicBlocked,
    logicSaveFailed,
  } from "$lib/stores/logics.svelte";
  import type { LogicTemplate } from "$logic/types";

  let {
    dirty = $bindable(false),
    embedded = false,
    focusId = "",
  }: { dirty?: boolean; embedded?: boolean; focusId?: string } = $props();

  const doc = $derived(getLogicDocument());
  const writable = $derived(isLogicsWritable());
  const blocked = $derived(logicBlocked());
  const saveFailed = $derived(logicSaveFailed());
  const builtinIds = new Set(BUILTIN_TEMPLATES.map((template) => template.id));
  const allTemplates = $derived([
    ...BUILTIN_TEMPLATES,
    ...(doc.templates ?? []).filter(
      (template) =>
        template &&
        typeof template.id === "string" &&
        typeof template.name === "string",
    ),
  ]);

  let selectedId = $state(BUILTIN_TEMPLATES[0].id);
  let json = $state("");
  let loadedId = $state("");
  let loadedJson = $state("");
  let error = $state("");
  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let pendingDelete = $state<LogicTemplate | null>(null);
  let pendingAction: (() => void) | null = null;
  let askClose = $state(false);

  const selected = $derived(
    allTemplates.find((template) => template.id === selectedId) ??
      BUILTIN_TEMPLATES[0],
  );
  const isBuiltin = $derived(!!selected && builtinIds.has(selected.id));
  const isDirty = $derived(!!selected && json !== loadedJson);

  $effect(() => {
    if (!selected) return;
    if (selected.id !== loadedId) {
      json = JSON.stringify(selected, null, 2);
      loadedId = selected.id;
      loadedJson = json;
      error = "";
      return;
    }
    if (json === loadedJson) {
      const next = JSON.stringify(selected, null, 2);
      if (next !== json) {
        json = next;
        loadedJson = next;
      }
    }
  });
  $effect(() => {
    if (embedded && focusId) selectedId = focusId;
  });
  $effect(() => {
    dirty = isDirty;
  });

  function guard(action: () => void): void {
    if (isDirty) {
      pendingAction = action;
      askClose = true;
      return;
    }
    action();
  }

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? allTemplates.filter(
          (template) =>
            String(template.name ?? "")
              .toLowerCase()
              .includes(q) ||
            String(template.description ?? "")
              .toLowerCase()
              .includes(q),
        )
      : [...allTemplates];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort(
      (a, b) => dir * String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
  });

  function duplicate(): void {
    if (!selected || !writable) return;
    const copy: LogicTemplate = {
      ...structuredClone($state.snapshot(selected)),
      id: newId(),
      name: `${selected.name} copy`,
    };
    const next = [...(doc.templates ?? []), copy];
    if (!commitLogics({ ...doc, templates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    if (logicBlocked()) {
      error = "Not saved — fix the logic errors in the document.";
      return;
    }
    selectedId = copy.id;
  }

  function save(): void {
    if (!selected || isBuiltin || !writable) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const problem = logicTemplateProblem(
      parsed,
      allTemplates.map((template) => template.id),
      doc.logics.map((logic) => logic.id),
      selected.id,
    );
    if (problem) {
      error = problem;
      return;
    }
    const entry = parsed as LogicTemplate;
    const next = [
      ...(doc.templates ?? []).filter(
        (template) => template.id !== selected.id,
      ),
      entry,
    ];
    if (!commitLogics({ ...doc, templates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    if (logicBlocked()) {
      error = "Not saved — fix the logic errors in the document.";
      return;
    }
    json = JSON.stringify(entry, null, 2);
    loadedJson = json;
    loadedId = entry.id;
    selectedId = entry.id;
    error = "";
  }

  function remove(): void {
    if (!selected || isBuiltin || !writable) return;
    const next = (doc.templates ?? []).filter(
      (template) => template.id !== selected.id,
    );
    if (!commitLogics({ ...doc, templates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    if (logicBlocked()) {
      error = "Not saved — fix the logic errors in the document.";
      return;
    }
    selectedId = BUILTIN_TEMPLATES[0].id;
    pendingDelete = null;
  }
</script>

<div class="logic-templates">
  {#if !embedded}
    <div class="page-header">
      <div class="page-heading">
        <h2>Logic templates</h2>
        <p class="text-muted hint">
          Logic definitions with parameter placeholders. Duplicate a built-in to
          edit it.
        </p>
      </div>
      <div class="page-actions">
        <button
          type="button"
          class="btn btn-sm"
          disabled={!writable || blocked}
          onclick={() => guard(duplicate)}
        >
          Duplicate
        </button>
      </div>
    </div>
  {/if}

  {#if !writable}
    <p class="text-danger hint">
      Logic templates could not be loaded — saving is disabled so the stored
      document is not overwritten.
    </p>
  {:else if blocked}
    <p class="text-danger hint">
      Not saved yet — fix the logic errors in the document. The adapter keeps
      the last valid version.
    </p>
  {:else if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}

  {#if !embedded}
    <div class="filter-bar">
      <input
        type="search"
        placeholder="Search name or description…"
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
            onclick={() => guard(() => (selectedId = template.id))}
          >
            <span class="name">{template.name}</span>
            <span class="badge"
              >{builtinIds.has(template.id) ? "built-in" : "user"}</span
            >
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if selected}
    <div class="editor">
      <div class="editor-head">
        <span class="label-mono">{selected.name}</span>
        {#if isBuiltin}
          <span class="item-actions">
            <span class="hint text-muted">Built-in — duplicate to edit.</span>
            <button
              type="button"
              class="btn btn-sm"
              disabled={!writable || blocked}
              onclick={duplicate}
            >
              Duplicate
            </button>
          </span>
        {:else}
          <span class="item-actions">
            <button
              type="button"
              class="btn btn-sm"
              disabled={!writable || blocked}
              onclick={duplicate}
            >
              Duplicate
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={!writable || blocked || !isDirty}
              onclick={save}
            >
              Save
            </button>
            <IconButton
              icon="delete"
              danger
              label={`Delete ${selected.name}`}
              onclick={() => guard(() => (pendingDelete = selected))}
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
        aria-label="Logic template JSON"
      ></textarea>
      {#if error}
        <p class="text-danger hint">{error}</p>
      {/if}
    </div>
  {/if}

  {#if askClose}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => {
        askClose = false;
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
      onConfirm={remove}
      onCancel={() => (pendingDelete = null)}
    >
      <p>Inserted logics keep their copy.</p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .logic-templates {
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

  .badge {
    font-size: var(--body-sm);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
    white-space: nowrap;
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
