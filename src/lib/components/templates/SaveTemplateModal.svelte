<script lang="ts">
  import { DEVICE_TYPES } from "$lib/config/features";
  import type { DeviceType } from "$lib/types/device";

  let {
    suggestedName = "",
    suggestedType = "Light",
    error = "",
    onSave,
    onClose,
  }: {
    suggestedName?: string;
    suggestedType?: DeviceType;
    error?: string;
    onSave: (name: string, type: DeviceType) => void;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(suggestedName);
  // svelte-ignore state_referenced_locally
  let type = $state<DeviceType>(suggestedType);
  // svelte-ignore state_referenced_locally
  let nameTouched = $state(suggestedName !== `${suggestedType} template`);
  let localError = $state("");

  // The default name follows the type (function), not the tile/room name.
  $effect(() => {
    if (!nameTouched) name = `${type} template`;
  });

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const next = name.trim();
    localError = next ? "" : "Give the template a name.";
    if (!localError) onSave(next, type);
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
  aria-label="Save tile as template"
>
  <form class="modal-card card" onsubmit={submit}>
    <h3>Save tile as template</h3>
    <p class="hint text-muted">
      State sources become roles with their repaired fields, so the template
      fits another set of states. Applying it creates the missing overrides.
      Slots that match no role are left out.
    </p>
    <label class="field">
      <span class="label-mono">Name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={name}
        oninput={() => (nameTouched = true)}
        autofocus
        autocomplete="off"
        maxlength="80"
      />
    </label>
    <label class="field">
      <span class="label-mono">Type</span>
      <select bind:value={type}>
        {#each DEVICE_TYPES as deviceType (deviceType)}
          <option value={deviceType}>{deviceType}</option>
        {/each}
      </select>
    </label>
    {#if localError || error}
      <p class="text-danger error">{localError || error}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button type="submit" class="btn btn-primary">
        <span class="material-symbols-outlined" aria-hidden="true">save</span>
        Save template
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
    display: flex;
    flex-direction: column;
    width: min(28rem, 100%);
    max-height: 88vh;
    overflow: auto;
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

  .field input,
  .field select {
    width: 100%;
    box-sizing: border-box;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.5rem;
  }
</style>
