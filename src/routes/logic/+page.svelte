<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { LogicDef } from "$logic/types";
  import {
    commitLogics,
    getLogicDocument,
    logicBlocked,
    logicSaveFailed,
    logicsLoadKind,
  } from "$lib/stores/logics.svelte";
  import LogicEditor from "$lib/components/logic/LogicEditor.svelte";
  import TemplateInsert from "$lib/components/logic/TemplateInsert.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { validateLogicDocument } from "$logic/validate";
  import type { Issue } from "$logic/validate";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { variableNameFor } from "$lib/config/variables";

  const doc = $derived(getLogicDocument());
  let selectedId = $state<string | null>(null);
  let pendingDelete = $state<LogicDef | null>(null);
  let inserting = $state(false);
  /** The open editor, scrolled into view like the device list does. */
  let inlineForm: HTMLElement | undefined = $state();

  $effect(() => {
    if (selectedId && inlineForm) {
      inlineForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  function uniqueId(base: string): string {
    const taken = doc.logics.map((logic) => logic.id);
    let id = base;
    let index = 2;
    while (taken.includes(id)) id = `${base}-${index++}`;
    return id;
  }

  function commit(logics: LogicDef[]): boolean {
    return commitLogics({ ...doc, logics });
  }

  function addMachine() {
    const id = uniqueId("logic");
    const logic: LogicDef = {
      id,
      name: "New state machine",
      kind: "machine",
      output: { scope: "memory", name: id },
      states: { Idle: {} },
    };
    if (commit([...doc.logics, logic])) select(logic);
  }

  function addAction() {
    const id = uniqueId("action");
    const logic: LogicDef = {
      id,
      name: "New action",
      kind: "function",
      output: { scope: "memory", name: id },
      expr: { const: 0 },
    };
    if (commit([...doc.logics, logic])) select(logic);
  }

  function duplicate(logic: LogicDef) {
    const id = uniqueId(`${logic.id}-copy`);
    const copy = $state.snapshot(logic) as LogicDef;
    copy.id = id;
    copy.name = `${logic.name} copy`;
    if (copy.output?.scope === "memory" && copy.output.name === logic.id) {
      copy.output.name = id;
    }
    if (commit([...doc.logics, copy])) select(copy);
  }

  function update(next: LogicDef) {
    commit(doc.logics.map((logic) => (logic.id === next.id ? next : logic)));
  }

  function toggle(logic: LogicDef, enabled: boolean) {
    update({ ...logic, enabled });
  }

  function confirmDelete() {
    if (pendingDelete) {
      commit(doc.logics.filter((logic) => logic.id !== pendingDelete!.id));
      if (selectedId === pendingDelete.id) selectedId = null;
    }
    pendingDelete = null;
  }

  /** The row being edited: edits happen on a copy, so the adapter only sees them
   *  on Save (the same draft model as the tile editor). */
  let draft = $state<LogicDef | null>(null);
  let askClose = $state(false);
  /** The row the user picked while the draft was dirty. */
  let pendingSelect = $state<LogicDef | null>(null);

  const selectedLogic = $derived(
    doc.logics.find((logic) => logic.id === selectedId) ?? null,
  );
  const dirty = $derived(
    !!draft &&
      !!selectedLogic &&
      JSON.stringify(draft) !== JSON.stringify(selectedLogic),
  );
  const issues = $derived.by((): Issue[] => {
    const current = draft;
    if (!current) return [];
    return validateLogicDocument({ version: 1, logics: [current] }).filter(
      (issue) => issue.logicId === current.id,
    );
  });
  const canSave = $derived(
    dirty && !issues.some((issue) => issue.severity === "error"),
  );

  /** The row's name opens it; clicking another row asks first when the draft is
   *  dirty, so an edit is never dropped silently. */
  function select(logic: LogicDef) {
    if (dirty) {
      pendingSelect = logic;
      askClose = true;
      return;
    }
    openLogic(logic);
  }

  function openLogic(logic: LogicDef) {
    const stored = doc.logics.find((item) => item.id === logic.id) ?? logic;
    selectedId = stored.id;
    draft = $state.snapshot(stored) as LogicDef;
    askClose = false;
    pendingSelect = null;
  }

  function patch(update: Partial<LogicDef>) {
    if (draft) draft = { ...draft, ...update } as LogicDef;
  }

  /** A state id that a global variable stands for becomes the variable's name,
   *  so changing the variable later changes every logic that uses it. */
  function normalizeRefs(logic: LogicDef): LogicDef {
    const vars = getVariables();
    const toName = (ref: string) => variableNameFor(ref, vars);
    const inputs = Object.fromEntries(
      Object.entries(logic.inputs ?? {}).map(([name, input]) => {
        if (input.from.type !== "state") return [name, input];
        return [
          name,
          {
            ...input,
            from: {
              ...input.from,
              ref: toName(input.from.ref),
              refs: (input.from.refs ?? []).map(toName),
            },
          },
        ];
      }),
    ) as LogicDef["inputs"];
    const output =
      logic.output?.scope === "state"
        ? { ...logic.output, ref: toName(logic.output.ref) }
        : logic.output;
    return { ...logic, inputs, output } as LogicDef;
  }

  function save() {
    if (!canSave || !draft) return;
    const next = normalizeRefs(draft);
    update(next);
    draft = $state.snapshot(next) as LogicDef;
  }

  function revert() {
    if (selectedLogic) draft = $state.snapshot(selectedLogic) as LogicDef;
  }

  function closeEditor() {
    if (dirty) {
      askClose = true;
      return;
    }
    selectedId = null;
    draft = null;
  }

  /** The whole line opens/closes its item — except the actions and any control
   *  (the name input while open, the checkboxes). */
  function onLineClick(event: MouseEvent, logic: LogicDef) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    if (selectedId === logic.id) closeEditor();
    else select(logic);
  }

  /** While the row is open these edit the draft; closed, they write at once. */
  function setEnabled(logic: LogicDef, enabled: boolean) {
    if (selectedId === logic.id) patch({ enabled });
    else toggle(logic, enabled);
  }

  function setLog(logic: LogicDef, log: boolean) {
    if (selectedId === logic.id) patch({ log: log || undefined });
    else update({ ...logic, log: log || undefined });
  }

  function outputLabel(logic: LogicDef): string {
    const output = logic.output;
    if (!output) return `memory: ${logic.id}`;
    if (output.scope === "memory") return `memory: ${output.name ?? logic.id}`;
    return output.ref || "(no state)";
  }
</script>

<svelte:head>
  <title>Logic - iHome</title>
</svelte:head>

<div class="logic-page">
  <div class="page-heading">
    <div class="title-line">
      <h1>Logic</h1>
      <div class="page-actions">
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (inserting = true)}
        >
          <span class="material-symbols-outlined">dashboard_customize</span>
          Insert template
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={addMachine}
        >
          <span class="material-symbols-outlined">add</span> State machine
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={addAction}
        >
          <span class="material-symbols-outlined">add</span> Action
        </button>
      </div>
    </div>
    <p class="text-muted hint">
      Automations the adapter runs: switches and sensors with timers, or a
      computed value. A logic without an external output works inside the
      adapter only.
    </p>
  </div>

  {#if logicsLoadKind() === "unreadable"}
    <p class="text-danger hint">
      The stored logic document is unreadable — nothing can be saved until it is
      repaired.
    </p>
  {:else if logicsLoadKind() === "pending"}
    <p class="text-muted hint">Loading the logic document…</p>
  {/if}

  {#if doc.logics.length === 0}
    <div class="card empty-state">
      <p class="text-muted">
        No logics yet — insert a template or add an empty one.
      </p>
    </div>
  {:else}
    <div class="logic-list">
      {#each doc.logics as logic (logic.id)}
        {@const open = selectedId === logic.id}
        <div class="item" class:open>
          <!-- The free line area is a mouse convenience: keyboard users open/close
               with the name button and close with the ×. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="item-line" onclick={(e) => onLineClick(e, logic)}>
            {#if open && draft}
              <input
                class="name-input"
                value={draft.name}
                aria-label="Logic name"
                onchange={(e) =>
                  patch({ name: e.currentTarget.value.trim() || draft.id })}
              />
            {:else}
              <button type="button" class="name" onclick={() => select(logic)}>
                {logic.name}
              </button>
            {/if}
            <span class="badge badge-secondary">{logic.kind}</span>
            <span class="mono hint text-muted">{outputLabel(logic)}</span>
            {#if logic.enabled === false}
              <span class="badge badge-secondary">disabled</span>
            {/if}
            <span class="item-actions">
              <label class="inline"
                >enabled <input
                  type="checkbox"
                  checked={open && draft
                    ? draft.enabled !== false
                    : logic.enabled !== false}
                  onchange={(e) => setEnabled(logic, e.currentTarget.checked)}
                /></label
              >
              <label class="inline" title="Log state changes to the adapter log"
                >log <input
                  type="checkbox"
                  checked={open && draft
                    ? draft.log === true
                    : logic.log === true}
                  onchange={(e) => setLog(logic, e.currentTarget.checked)}
                /></label
              >
              {#if open}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={!canSave}
                  onclick={save}>Save</button
                >
                <button
                  type="button"
                  class="btn btn-sm"
                  title="Discard the changes and stay in the editor"
                  disabled={!dirty}
                  onclick={revert}>Revert</button
                >
                <IconButton
                  icon="close"
                  label="Close the editor"
                  title="Close"
                  onclick={closeEditor}
                />
              {/if}
              <IconButton
                icon="content_copy"
                label={`Duplicate ${logic.name}`}
                title="Duplicate"
                onclick={() => duplicate(logic)}
              />
              <IconButton
                icon="delete"
                danger
                label={`Delete ${logic.name}`}
                onclick={() => (pendingDelete = logic)}
              />
            </span>
          </div>
          {#if open && draft}
            <div class="item-editor" bind:this={inlineForm}>
              <LogicEditor bind:draft {issues} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if logicBlocked()}
    <p class="text-danger hint">
      Not saved yet — fix the errors above. The adapter keeps the last valid
      version.
    </p>
  {:else if logicSaveFailed()}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
</div>

{#if inserting}
  <TemplateInsert
    taken={doc.logics.map((logic) => logic.id)}
    onInsert={(logic) => {
      if (commit([...doc.logics, logic])) select(logic);
    }}
    onClose={() => (inserting = false)}
  />
{/if}

{#if askClose}
  <ConfirmModal
    title="Discard unsaved changes?"
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={() => {
      askClose = false;
      const next = pendingSelect;
      pendingSelect = null;
      if (next) openLogic(next);
      else {
        selectedId = null;
        draft = null;
      }
    }}
    onCancel={() => {
      askClose = false;
      pendingSelect = null;
    }}
  />
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("logic", pendingDelete.name)}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

<style>
  .logic-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 860px;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-heading h1 {
    margin: 0;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .title-line h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    flex-wrap: wrap;
  }

  .page-actions .material-symbols-outlined {
    font-size: 18px;
  }

  .hint {
    font-size: var(--body-sm);
  }

  .logic-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  /* One item is one box: the line is its header, the editor sits inside it
     (UI-DESIGN §5.1/§5.3). */
  .item {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
    background: var(--surface-color);
    padding: 0.25rem 0.5rem;
  }

  .item.open {
    background: var(--row-hover);
    border-color: var(--primary-color);
  }

  .item-line,
  .item-actions,
  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .item-line {
    cursor: pointer;
  }

  .item-actions {
    margin-left: auto;
    cursor: default;
  }

  .name {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-color);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }

  .name:hover {
    color: var(--primary-color);
  }

  .name-input {
    flex: 1 1 14rem;
    min-width: 10rem;
    font-size: var(--body-lg);
    font-weight: 600;
  }

  .item-editor {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
    padding: 1rem;
  }
</style>
