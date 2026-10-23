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

  /** Entering/verifying a PIN uses the pad; only *defining* one uses fields
   *  (`expected === undefined`). */
  const verifying = $derived(expected !== undefined);

  /** A digit lands in the entry and verifies itself the moment the entry
   *  reaches the expected PIN's length — the phone-lock behaviour, and the
   *  reason the pad needs no OK button. */
  function press(digit: string): void {
    if (entry.length >= 6) return;
    error = "";
    entry += digit;
    if (expected !== undefined && entry.length === expected.length) verify();
  }

  function back(): void {
    error = "";
    entry = entry.slice(0, -1);
  }

  function verify(): void {
    if (entry !== expected) {
      // Clear on a miss so the next attempt starts from scratch.
      error = "Wrong PIN";
      entry = "";
      return;
    }
    onSubmit(entry);
  }

  /** The hardware keyboard drives the pad too, so a desktop keeps working. */
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      onCancel();
      return;
    }
    if (!verifying) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    } else if (e.key === "Enter" && entry !== "") {
      e.preventDefault();
      verify();
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    // Set: keep what was typed after an error, so a typo can be fixed.
    if (!isValidPin(entry)) error = "Use 4-6 digits.";
    else if (isDefaultPin(entry))
      error = "Choose a PIN other than the default.";
    else if (entry !== repeat) error = "PINs do not match.";
    else onSubmit(entry);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <div class="modal-card card">
    <h3>{title}</h3>
    {#if hint}
      <p class="hint text-muted">{hint}</p>
    {/if}
    {#if verifying}
      <div class="dots" aria-hidden="true">
        {#each entry.split("") as _digit, i (i)}
          <span class="dot"></span>
        {/each}
      </div>
      {#if error}
        <p class="text-danger">{error}</p>
      {/if}
      <div class="pad">
        {#each ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as digit (digit)}
          <button type="button" class="key" onclick={() => press(digit)}
            >{digit}</button
          >
        {/each}
        <button type="button" class="key key-text" onclick={onCancel}
          >Cancel</button
        >
        <button type="button" class="key" onclick={() => press("0")}>0</button>
        <button
          type="button"
          class="key"
          title="Delete the last digit"
          aria-label="Delete the last digit"
          onclick={back}
        >
          <span class="material-symbols-outlined">backspace</span>
        </button>
      </div>
    {:else}
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
        {#if error}
          <p class="text-danger">{error}</p>
        {/if}
        <div class="actions">
          <button type="button" class="btn" onclick={onCancel}>Cancel</button>
          <button type="submit" class="btn btn-primary">{confirmLabel}</button>
        </div>
      </form>
    {/if}
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

  /* The entry, masked: one dot per digit, the row keeping its height so the
     pad does not jump when the first digit lands. */
  .dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.6rem;
    min-height: 2rem;
  }

  .dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background-color: var(--text-color);
  }

  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
  }

  .key {
    padding: 0.7rem 0;
    font-size: 1.15rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-container-lowest);
    color: var(--text-color);
    cursor: pointer;
  }

  .key:hover {
    background-color: var(--surface-container-low);
  }

  .key-text {
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
