<script lang="ts">
  import type { Template } from "$lib/types/display";

  let {
    templates,
    error = "",
    warning = "",
    onPick,
    onClose,
  }: {
    templates: Template[];
    /** Why the last apply attempt did not happen. */
    error?: string;
    /** What the tile loses when it reads more than one source. */
    warning?: string;
    onPick: (template: Template) => void;
    onClose: () => void;
  } = $props();

  let search = $state("");
  let selected = $state<Template | null>(null);
  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return [...templates]
      .filter(
        (template) =>
          !q ||
          String(template.name ?? "")
            .toLowerCase()
            .includes(q) ||
          String(template.type ?? "")
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
/>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Apply a template"
>
  <div class="modal-card card">
    <h3>Apply a template</h3>
    <p class="hint text-muted">
      Replaces this tile's slots, size and look with the template. Its state or
      device source stays the anchor.
    </p>
    {#if warning}
      <p class="hint text-warning">{warning}</p>
    {/if}
    <label class="field">
      <span class="label-mono">Search</span>
      <input type="search" bind:value={search} placeholder="name or type…" />
    </label>
    <div class="template-pick">
      {#each shown as template (template.id)}
        <button
          type="button"
          class="template-row"
          class:active={selected?.id === template.id}
          onclick={() => (selected = template)}
        >
          <span class="name">{template.name}</span>
          <span class="badge"
            >{template.type}{template.builtin ? " · built-in" : ""}</span
          >
        </button>
      {/each}
      {#if shown.length === 0}
        <p class="hint text-muted">No templates match the search.</p>
      {/if}
    </div>
    {#if error}
      <p class="text-danger error">{error}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn btn-sm" onclick={onClose}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        disabled={!selected}
        onclick={() => selected && onPick(selected)}
      >
        <span class="material-symbols-outlined" aria-hidden="true"
          >file_open</span
        >
        Apply template
      </button>
    </div>
  </div>
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

  /* A flex card: the list scrolls, the actions stay on screen. */
  .modal-card {
    display: flex;
    flex-direction: column;
    width: min(36rem, 100%);
    max-height: 88vh;
    overflow: hidden;
    padding: 1rem;
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

  .field input {
    width: 100%;
    box-sizing: border-box;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .template-pick {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .template-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .template-row:hover,
  .template-row.active {
    background: var(--surface-container);
  }

  .template-row .name {
    font-weight: 600;
  }

  .template-row .badge {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex: 0 0 auto;
    padding-top: 0.5rem;
  }
</style>
