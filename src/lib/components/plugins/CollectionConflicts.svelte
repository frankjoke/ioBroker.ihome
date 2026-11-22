<script lang="ts">
  import type { CollectionConflict } from "$adapter/plugin-collection";

  let {
    conflicts,
    onCancel,
    onOverwrite,
  }: {
    conflicts: CollectionConflict[];
    onCancel: () => void;
    onOverwrite: () => void;
  } = $props();
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Collection conflicts"
>
  <div class="modal-card card">
    <h3>Collection conflicts</h3>
    <p class="hint text-muted">
      These live items differ from the plugin's saved version or belong to
      someone else. Overwriting replaces the edited definitions; state values
      are kept.
    </p>
    <ul class="conflicts">
      {#each conflicts as conflict (conflict.kind + conflict.id)}
        <li>
          <span class="badge">{conflict.kind}</span>
          <span class="mono">{conflict.id}</span>
          <span class="text-muted">{conflict.reason}</span>
        </li>
      {/each}
    </ul>
    <div class="actions">
      <button type="button" class="btn" onclick={onCancel}>Cancel</button>
      <button type="button" class="btn btn-danger" onclick={onOverwrite}>
        Overwrite and apply
      </button>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.5);
  }

  .modal-card {
    width: min(34rem, 100%);
    max-height: 90vh;
    overflow-y: auto;
    padding: 1rem;
  }

  .conflicts {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0.75rem 0;
    padding: 0;
    list-style: none;
  }

  .conflicts li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
