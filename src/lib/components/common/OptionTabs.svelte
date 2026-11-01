<script lang="ts" generics="T extends string">
  import type { Snippet } from "svelte";

  /** Tabbed options (UI-DESIGN §6): menu-bar tabs over a body, one group open at
   *  a time, and a hover hint on every tab. The caller supplies the groups and
   *  the open body, so the strip never repeats a group's name. */
  let {
    tabs,
    value = $bindable(null),
    label,
    collapsible = true,
    children,
  }: {
    tabs: readonly { id: T; label: string; hint: string }[];
    /** The open tab; null = all closed. Bind it to keep the state. */
    value?: T | null;
    /** Accessible name of the strip. */
    label: string;
    /** True: clicking the open tab closes it. False: one tab is always open. */
    collapsible?: boolean;
    /** The open group's body, called with the open id. */
    children?: Snippet<[T | null]>;
  } = $props();

  /** The open tab's hint, also readable on touch where a tooltip cannot open. */
  const openHint = $derived(tabs.find((t) => t.id === value)?.hint);
</script>

<div class="option-tabs-shell">
  <div class="option-tabs" aria-label={label}>
    {#each tabs as t (t.id)}
      <button
        type="button"
        class="option-tab"
        class:active={value === t.id}
        aria-expanded={value === t.id}
        title={t.hint}
        onclick={() =>
          (value = value === t.id ? (collapsible ? null : value) : t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>
  {#if openHint}
    <p class="option-tab-hint touch-only">{openHint}</p>
  {/if}
  {@render children?.(value)}
</div>

<style>
  /* The strip and the body stay children of the host's own flex column, so the
     host's gap separates them like any other field. */
  .option-tabs-shell {
    display: contents;
  }

  .option-tab-hint {
    margin: 0;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }
</style>
