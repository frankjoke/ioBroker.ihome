<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { BUILTIN_TEMPLATES, instantiateTemplate } from "$logic/templates";
  import { validateLogicDocument } from "$logic/validate";
  import {
    commitLogics,
    getLogicDocument,
  } from "$lib/stores/logics.svelte";
  import type { LogicTemplate } from "$logic/types";

  const doc = $derived(getLogicDocument());
  const builtinIds = new Set(BUILTIN_TEMPLATES.map((template) => template.id));
  const allTemplates = $derived([
    ...BUILTIN_TEMPLATES,
    ...(doc.templates ?? []),
  ]);

  let selectedId = $state(BUILTIN_TEMPLATES[0].id);
  let json = $state("");
  let error = $state("");
  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let pendingDelete = $state<LogicTemplate | null>(null);

  const selected = $derived(
    allTemplates.find((template) => template.id === selectedId) ??
      BUILTIN_TEMPLATES[0],
  );
  const isBuiltin = $derived(
    !!selected && builtinIds.has(selected.id),
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
            (template.description ?? "").toLowerCase().includes(q),
        )
      : [...allTemplates];
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => dir * a.name.localeCompare(b.name));
  });

  function duplicate(): void {
    if (!selected) return;
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
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as LogicTemplate).id !== "string" ||
      typeof (parsed as LogicTemplate).name !== "string" ||
      !Array.isArray((parsed as LogicTemplate).params) ||
      !(parsed as LogicTemplate).logic ||
      typeof (parsed as LogicTemplate).logic !== "object"
    ) {
      error = "A logic template needs id, name, params and logic.";
      return;
    }
    const entry = parsed as LogicTemplate;
    if (
      entry.params.some(
        (param) =>
          !param ||
          typeof param.name !== "string" ||
          typeof param.label !== "string" ||
          typeof param.type !== "string",
      )
    ) {
      error = "Each parameter needs name, label and type.";
      return;
    }
    const defaults: Record<string, string | number | boolean> = {};
    for (const param of entry.params) {
      if (param.default !== undefined) defaults[param.name] = param.default;
    }
    try {
      const logic = instantiateTemplate(entry, defaults, entry.id);
      const issues = validateLogicDocument({
        version: 3,
        logics: [logic],
      }).filter((issue) => issue.severity === "error");
      if (issues.length > 0) {
        error = `${issues[0].path}: ${issues[0].message}`;
        return;
      }
    } catch {
      // Required parameters without defaults: shape-only validation.
    }
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
    selectedId = entry.id;
    error = "";
  }

  function remove(): void {
    if (!selected || isBuiltin) return;
    const next = (doc.templates ?? []).filter(
      (template) => template.id !== selected.id,
    );
    if (!commitLogics({ ...doc, templates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    selectedId = BUILTIN_TEMPLATES[0].id;
    pendingDelete = null;
  }
</script>

<div class="logic-templates">
  <div class="page-header">
    <div class="page-heading">
      <h2>Logic templates</h2>
      <p class="text-muted hint">
        Logic definitions with parameter placeholders. Duplicate a built-in to
        edit it.
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
          onclick={() => (selectedId = template.id)}
        >
          <span class="name">{template.name}</span>
          <span class="badge">{builtinIds.has(template.id) ? "built-in" : "user"}</span>
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
        aria-label="Logic template JSON"
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
