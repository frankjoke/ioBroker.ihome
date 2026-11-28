<script lang="ts">
  import {
    removeStateLabel,
    renameStateLabel,
    setStateLabel,
    type StateLabels,
  } from "$lib/config/state-labels";

  let {
    value,
    onChange,
  }: {
    value: StateLabels | undefined;
    onChange: (next: StateLabels | undefined) => void;
  } = $props();

  let newValue = $state("");
  let newLabel = $state("");
  const rows = $derived(Object.entries(value ?? {}));

  function change(next: StateLabels | undefined): void {
    onChange(next);
  }

  function add(): void {
    const key = newValue.trim();
    if (!key) return;
    change(setStateLabel(value, key, newLabel));
    newValue = "";
    newLabel = "";
  }
</script>

<div class="section-panel states">
  <span class="label-mono">States (value → label)</span>
  {#each rows as [key, label] (key)}
    <div class="state-row">
      <input
        class="mono"
        type="text"
        value={key}
        aria-label={`Value ${key}`}
        onchange={(event) =>
          change(renameStateLabel(value, key, event.currentTarget.value))}
      />
      <input
        type="text"
        value={label}
        aria-label={`Label for ${key}`}
        oninput={(event) =>
          change(setStateLabel(value, key, event.currentTarget.value))}
      />
      <button
        type="button"
        class="icon-btn"
        title="Remove"
        aria-label={`Remove state ${key}`}
        onclick={() => change(removeStateLabel(value, key))}
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
  {/each}
  <div class="state-row">
    <input class="mono" type="text" placeholder="value" bind:value={newValue} />
    <input type="text" placeholder="label" bind:value={newLabel} />
    <button
      type="button"
      class="icon-btn"
      title="Add"
      aria-label="Add state label"
      onclick={add}
    >
      <span class="material-symbols-outlined">add</span>
    </button>
  </div>
</div>

<style>
  .states {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .state-row {
    display: flex;
    gap: 0.35rem;
  }

  .state-row input {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
