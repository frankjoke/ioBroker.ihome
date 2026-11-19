<script lang="ts">
  import { isHexColor } from "$lib/config/appearance";
  import { BADGE_COLORS, resolveColorToken } from "$lib/config/rule-ops";

  /** One colour control for every editor: a default/none entry, the theme
   *  palette with a swatch per entry, and a custom value (colour input plus a
   *  free-text field for any CSS colour). Stored values are palette tokens
   *  (`var(--danger-color)`) or raw CSS; older names ("danger") still resolve. */
  let {
    value = undefined,
    onChange,
    label,
    defaultLabel = "default",
    customDefault = "#494bd6",
  }: {
    value?: string;
    onChange: (value: string | undefined) => void;
    /** Accessible name of the control, e.g. "Badge colour". */
    label: string;
    defaultLabel?: string;
    customDefault?: string;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  const entries = $derived(Object.entries(BADGE_COLORS));
  const token = $derived(resolveColorToken(value));
  const name = $derived(
    token ? (entries.find(([, entry]) => entry === token)?.[0] ?? token) : "",
  );
  const custom = $derived(Boolean(value) && !token);
  const display = $derived(value ? name || value : defaultLabel);

  function pick(next: string | undefined): void {
    open = false;
    onChange(next);
  }

  function pickCustom(): void {
    open = false;
    if (!custom) onChange(customDefault);
  }

  function closeOutside(event: MouseEvent): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window
  onclick={closeOutside}
  onkeydown={(e) => {
    if (e.key === "Escape") open = false;
  }}
/>

<div class="color-select" bind:this={root}>
  <button
    type="button"
    class="trigger"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="swatch" class:empty={!value} style:background={value ?? ""}
    ></span>
    <span class="text" title={display}>{display}</span>
  </button>

  {#if open}
    <div class="list" role="listbox" aria-label={label}>
      <button
        type="button"
        role="option"
        aria-selected={!value}
        class="option"
        onclick={() => pick(undefined)}
      >
        <span class="name">{defaultLabel}</span>
        <span class="swatch empty"></span>
      </button>
      {#each entries as [entryName, entryToken] (entryName)}
        <button
          type="button"
          role="option"
          aria-selected={entryToken === token}
          class="option"
          onclick={() => pick(entryToken)}
        >
          <span class="name">{entryName}</span>
          <span class="swatch" style:background={entryToken}></span>
        </button>
      {/each}
      <button
        type="button"
        role="option"
        aria-selected={custom}
        class="option"
        onclick={pickCustom}
      >
        <span class="name">custom…</span>
        <span class="swatch" style:background={custom ? value : ""}></span>
      </button>
    </div>
  {/if}

  {#if custom}
    <div class="custom">
      <input
        type="color"
        aria-label={`${label} picker`}
        value={isHexColor(value) ? value : customDefault}
        oninput={(e) => onChange(e.currentTarget.value)}
      />
      <input
        type="text"
        aria-label={`${label} value`}
        {value}
        placeholder={customDefault}
        oninput={(e) => onChange(e.currentTarget.value.trim())}
      />
    </div>
  {/if}
</div>

<style>
  .color-select {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    min-width: 0;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color);
    color: var(--text-color);
    font: inherit;
    font-size: var(--body-sm);
    text-align: left;
    cursor: pointer;
  }

  .trigger:hover {
    background: var(--surface-container-low);
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swatch {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .swatch.empty {
    background: repeating-linear-gradient(
      45deg,
      transparent 0 3px,
      var(--border-color) 3px 4px
    );
  }

  .list {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    min-width: 100%;
    max-height: 16rem;
    overflow: auto;
    padding: 2px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color);
    box-shadow: var(--shadow-normal);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.4rem;
    border: 0;
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    font: inherit;
    font-size: var(--body-sm);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .option:hover,
  .option[aria-selected="true"] {
    background: var(--surface-container);
  }

  .name {
    flex: 1 1 auto;
  }

  .custom {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .custom input[type="color"] {
    flex: 0 0 auto;
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
  }

  .custom input[type="text"] {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
