<script lang="ts">
  let {
    title,
    label = "Name",
    confirmLabel = "Create",
    validate,
    onSubmit,
    onCancel,
  }: {
    title: string;
    label?: string;
    confirmLabel?: string;
    /** An error message for the current entry, or null when it may be used. */
    validate?: (value: string) => string | null;
    onSubmit: (value: string) => void;
    onCancel: () => void;
  } = $props();

  let value = $state("");
  let error = $state("");

  /** Trimmed before it is judged, so "  Bad " and "Bad" are the same entry. */
  function submit(e: SubmitEvent) {
    e.preventDefault();
    const next = value.trim();
    error = validate?.(next) ?? null;
    if (error) return;
    onSubmit(next);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <form class="modal-card card" onsubmit={submit}>
    <h3>{title}</h3>
    <label class="field">
      <span class="label-mono">{label}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value
        autofocus
        autocomplete="off"
        maxlength="80"
      />
    </label>
    {#if error}
      <p class="text-danger error">{error}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onCancel}>Cancel</button>
      <button type="submit" class="btn btn-primary">{confirmLabel}</button>
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
    width: min(420px, 100%);
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
  }

  .error {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
