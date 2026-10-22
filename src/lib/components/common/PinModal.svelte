<script lang="ts">
  import { isDefaultPin, isValidPin } from "$lib/config/pin.svelte";

  let {
    title,
    hint,
    label = "PIN",
    repeatLabel = "Repeat PIN",
    confirmLabel = "Unlock",
    expected,
    onSubmit,
    onCancel,
  }: {
    title: string;
    hint?: string;
    label?: string;
    repeatLabel?: string;
    confirmLabel?: string;
    /** The PIN to compare against — its absence means set-new-PIN mode. */
    expected?: string;
    onSubmit: (pin: string) => void;
    onCancel: () => void;
  } = $props();

  let entry = $state("");
  let repeat = $state("");
  let error = $state("");

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (expected !== undefined) {
      // Verify: clear on a miss so the next attempt starts from scratch.
      if (entry !== expected) {
        error = "Wrong PIN";
        entry = "";
        return;
      }
      onSubmit(entry);
      return;
    }
    // Set: keep what was typed after an error, so a typo can be fixed.
    if (!isValidPin(entry)) error = "Use 4-6 digits.";
    else if (isDefaultPin(entry))
      error = "Choose a PIN other than the default.";
    else if (entry !== repeat) error = "PINs do not match.";
    else onSubmit(entry);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <div class="modal-card card">
    <h3>{title}</h3>
    {#if hint}
      <p class="hint text-muted">{hint}</p>
    {/if}
    <form onsubmit={submit}>
      <label class="field">
        <span class="label-mono">{label}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="password"
          inputmode="numeric"
          autocomplete="off"
          maxlength="6"
          autofocus
          bind:value={entry}
        />
      </label>
      {#if expected === undefined}
        <label class="field">
          <span class="label-mono">{repeatLabel}</span>
          <input
            type="password"
            inputmode="numeric"
            autocomplete="off"
            maxlength="6"
            bind:value={repeat}
          />
        </label>
      {/if}
      {#if error}
        <p class="text-danger">{error}</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" onclick={onCancel}>Cancel</button>
        <button type="submit" class="btn btn-primary">{confirmLabel}</button>
      </div>
    </form>
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

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
