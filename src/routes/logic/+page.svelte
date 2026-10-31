<script lang="ts">
  import type { LogicDef } from "$logic/types";
  import {
    commitLogics,
    getLogicDocument,
    logicSaveFailed,
    logicsLoadKind,
  } from "$lib/stores/logics.svelte";
  import LogicEditor from "$lib/components/logic/LogicEditor.svelte";
  import TemplateInsert from "$lib/components/logic/TemplateInsert.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";

  const doc = $derived(getLogicDocument());
  let selectedId = $state<string | null>(null);
  let pendingDelete = $state<LogicDef | null>(null);
  let inserting = $state(false);

  const selected = $derived(
    doc.logics.find((logic) => logic.id === selectedId) ?? null,
  );

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

  function add() {
    const id = uniqueId("logic");
    const logic: LogicDef = {
      id,
      name: "New logic",
      kind: "machine",
      output: { scope: "memory", name: id },
      states: { Idle: {} },
    };
    if (commit([...doc.logics, logic])) selectedId = id;
  }

  function duplicate(logic: LogicDef) {
    const id = uniqueId(`${logic.id}-copy`);
    const copy = structuredClone(logic);
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
  <div class="page-header">
    <div class="page-heading">
      <h1>Logic</h1>
      <p class="text-muted hint">
        Automations the adapter runs: switches and sensors with timers, or a
        computed value. A logic without an external output works inside the
        adapter only.
      </p>
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-sm"
        onclick={() => (inserting = true)}>Insert template</button
      >
      <button type="button" class="btn btn-primary btn-sm" onclick={add}
        >New logic</button
      >
    </div>
  </div>

  {#if logicsLoadKind() === "unreadable"}
    <p class="text-danger hint">
      The stored logic document is unreadable — nothing can be saved until it is
      repaired.
    </p>
  {:else if logicsLoadKind() === "pending"}
    <p class="text-muted hint">Loading the logic document…</p>
  {/if}

  {#if selected}
    <LogicEditor
      logic={selected}
      onchange={update}
      onClose={() => (selectedId = null)}
    />
  {:else if doc.logics.length === 0}
    <div class="card empty-state">
      <p class="text-muted">
        No logics yet — insert a template or add an empty one.
      </p>
    </div>
  {:else}
    <div class="logic-list">
      {#each doc.logics as logic (logic.id)}
        <div class="card logic-row">
          <div class="logic-main">
            <button
              type="button"
              class="logic-open"
              onclick={() => (selectedId = logic.id)}
            >
              <span class="logic-name">{logic.name}</span>
              <span class="badge badge-secondary">{logic.kind}</span>
              <span class="mono hint text-muted">{outputLabel(logic)}</span>
            </button>
            {#if logic.enabled === false}
              <span class="badge badge-secondary">disabled</span>
            {/if}
          </div>
          <div class="logic-actions">
            <label class="inline"
              >on <input
                type="checkbox"
                checked={logic.enabled !== false}
                onchange={(e) => toggle(logic, e.currentTarget.checked)}
              /></label
            >
            <button
              type="button"
              class="btn btn-sm"
              onclick={() => duplicate(logic)}>Duplicate</button
            >
            <button
              type="button"
              class="icon-btn"
              aria-label={`Delete ${logic.name}`}
              onclick={() => (pendingDelete = logic)}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if logicSaveFailed()}
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
    title={`Delete ${pendingDelete.name}?`}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  >
    The logic is removed from the document; the adapter stops it immediately.
  </ConfirmModal>
{/if}

<style>
  .logic-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 860px;
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
  }

  .page-heading h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    gap: 0.5rem;
  }

  .hint {
    font-size: var(--body-sm);
  }

  .logic-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .logic-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.8rem;
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

  .logic-open {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .logic-name {
    font-weight: 600;
  }
</style>
