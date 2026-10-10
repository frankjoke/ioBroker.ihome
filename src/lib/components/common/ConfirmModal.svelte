<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title = "Confirm",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    children,
  }: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    children?: Snippet;
  } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <div class="modal-card card">
    <h3>{title}</h3>
    {#if children}
      <div class="modal-body">{@render children()}</div>
    {/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onCancel}>{cancelLabel}</button
      >
      <button type="button" class="btn btn-danger" onclick={onConfirm}
        >{confirmLabel}</button
      >
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

  .modal-body {
    font-size: var(--body-md);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
