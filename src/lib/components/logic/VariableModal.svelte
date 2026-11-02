<script lang="ts">
  import StateBrowser from "$lib/components/discovery/StateBrowser.svelte";
  import type { LogicDef } from "$logic/types";

  let {
    objects,
    rooms,
    roomsOf,
    enums,
    logics = [],
    existing = [],
    onCreate,
    onCancel,
  }: {
    objects: Map<string, any>;
    rooms: { id: string; label: string; icon?: string }[];
    roomsOf: (id: string) => string[];
    enums?: any;
    logics?: LogicDef[];
    /** Names already used by this logic's inputs. */
    existing?: string[];
    onCreate: (name: string, ref: string) => void;
    onCancel: () => void;
  } = $props();

  const NAME = /^[A-Za-z0-9_-]+$/;
  let name = $state("");
  let ref = $state("");
  let error = $state("");

  const problem = $derived.by(() => {
    const trimmed = name.trim();
    if (!trimmed) return "A name is required.";
    if (!NAME.test(trimmed)) return "Use letters, digits, _ or - (no spaces).";
    if (existing.includes(trimmed)) return "That name is already used.";
    return "";
  });
  const canCreate = $derived(!problem && ref !== "");

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = problem;
    if (!canCreate) return;
    onCreate(name.trim(), ref);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label="New variable">
  <form class="modal-card card" onsubmit={submit}>
    <h3>New variable</h3>
    <label class="field">
      <span class="label-mono">Name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={name}
        autofocus
        autocomplete="off"
        maxlength="60"
        placeholder="motion"
      />
    </label>
    {#if error || problem}
      <p class="text-danger error">{error || problem}</p>
    {/if}

    <span class="label-mono">Source</span>
    <div class="picker">
      <StateBrowser
        {objects}
        {rooms}
        {roomsOf}
        {enums}
        {logics}
        logicPick="state"
        onPick={(id) => (ref = id)}
      />
    </div>
    {#if ref}
      <p class="hint text-muted mono">selected: {ref}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={onCancel}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button type="submit" class="btn btn-primary" disabled={!canCreate}>
        <span class="material-symbols-outlined" aria-hidden="true">check</span>
        Create
      </button>
    </div>
  </form>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(720px, 100%);
    max-height: 90vh;
    overflow: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .picker {
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .error {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
