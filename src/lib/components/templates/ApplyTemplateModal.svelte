<script lang="ts">
  import type { Template } from "$lib/types/display";

  let {
    templates,
    error = "",
    onPick,
    onClose,
  }: {
    templates: Template[];
    /** Why the last apply attempt did not happen. */
    error?: string;
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
      <button type="button" class="btn" onclick={onClose}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
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
  .template-pick {
    max-height: 45vh;
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
    padding: 8px 10px;
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
</style>
