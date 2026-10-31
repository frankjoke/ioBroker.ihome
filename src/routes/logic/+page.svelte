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
    if (commit([...doc.logics, logic])) selectedId = id;
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
    if (commit([...doc.logics, logic])) selectedId = id;
  }

  function duplicate(logic: LogicDef) {
    const id = uniqueId(`${logic.id}-copy`);
    const copy = $state.snapshot(logic) as LogicDef;
    copy.id = id;
    copy.name = `${logic.name} copy`;
    if (copy.output?.scope === "memory" && copy.output.name === logic.id) {
      copy.output.name = id;
    }
    if (commit([...doc.logics, copy])) selectedId = id;
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
        <div class="card logic-row" class:editing={selectedId === logic.id}>
          <div class="logic-main">
            <span class="logic-name">{logic.name}</span>
            <span class="badge badge-secondary">{logic.kind}</span>
            <span class="mono hint text-muted">{outputLabel(logic)}</span>
            {#if logic.enabled === false}
              <span class="badge badge-secondary">disabled</span>
            {/if}
          </div>
          <div class="logic-actions">
            <label class="inline"
              >enabled <input
                type="checkbox"
                checked={logic.enabled !== false}
                onchange={(e) => toggle(logic, e.currentTarget.checked)}
              /></label
            >
            <IconButton
              icon="edit"
              label={`Edit ${logic.name}`}
              title={selectedId === logic.id ? "Close" : "Edit"}
              active={selectedId === logic.id}
              onclick={() =>
                (selectedId = selectedId === logic.id ? null : logic.id)}
            />
            <IconButton
              icon="content_copy"
              label={`Duplicate ${logic.name}`}
              title="Duplicate"
              onclick={() => duplicate(logic)}
            />
            <IconButton
              icon="delete"
              label={`Delete ${logic.name}`}
              onclick={() => (pendingDelete = logic)}
            />
          </div>
        </div>

        {#if selectedId === logic.id}
          <div class="inline-form" bind:this={inlineForm}>
            <LogicEditor
              {logic}
              onchange={update}
              onClose={() => (selectedId = null)}
            />
          </div>
        {/if}
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
      if (commit([...doc.logics, logic])) selectedId = logic.id;
    }}
    onClose={() => (inserting = false)}
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
    gap: 1.25rem;
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

  .logic-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    flex-wrap: wrap;
  }

  .logic-main,
  .logic-actions,
  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .logic-row.editing {
    border-color: var(--primary-color);
  }

  .inline-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-left: 1rem;
  }

  .logic-name {
    font-weight: 600;
  }
</style>
