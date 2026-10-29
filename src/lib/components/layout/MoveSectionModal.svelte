<script lang="ts">
  let {
    title,
    pages,
    current,
    onMove,
    onClose,
  }: {
    title: string;
    pages: { id: string; title?: string }[];
    /** The page the section is on now: disabled as a destination. */
    current: string;
    onMove: (pageId: string) => void;
    onClose: () => void;
  } = $props();

  const initialTarget = () => pages.find((p) => p.id !== current)?.id ?? "";
  let target = $state(initialTarget());

  function confirm(): void {
    if (target && target !== current) onMove(target);
  }
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
  aria-label={title}
  tabindex="-1"
>
  <div class="modal-card card">
    <h3>{title}</h3>
    <label class="field">
      <span class="label-mono">Destination page</span>
      <select bind:value={target}>
        {#each pages as page (page.id)}
          <option value={page.id} disabled={page.id === current}>
            {page.title || "Page"}{page.id === current ? " (current)" : ""}
          </option>
        {/each}
      </select>
    </label>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!target || target === current}
        onclick={confirm}>Move</button
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

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
