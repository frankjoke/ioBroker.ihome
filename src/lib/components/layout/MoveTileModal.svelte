<script lang="ts">
  let {
    title,
    sections,
    current,
    onMove,
    onClose,
  }: {
    title: string;
    sections: { id: string; title?: string }[];
    /** The section the tile is in now: disabled as a destination. */
    current: string;
    onMove: (sectionId: string) => void;
    onClose: () => void;
  } = $props();

  const initialTarget = () => sections.find((s) => s.id !== current)?.id ?? "";
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
      <span class="label-mono">Destination</span>
      <select bind:value={target}>
        {#each sections as section (section.id)}
          <option value={section.id} disabled={section.id === current}>
            {section.title || "Section"}{section.id === current
              ? " (current)"
              : ""}
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
