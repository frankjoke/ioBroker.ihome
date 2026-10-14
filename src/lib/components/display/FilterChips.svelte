<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { enumLabelFromObject } from "$lib/config/rooms";
  import type { FilterChips } from "$lib/config/pages-ops";

  let {
    chips,
    onChange,
  }: { chips: FilterChips; onChange: (next: FilterChips) => void } = $props();

  function options(type: string): { id: string; label: string }[] {
    return ((ioBroker.enums?.getList(type) as any[]) ?? []).map((e: any) => ({
      id: e._id,
      label: enumLabelFromObject(e),
    }));
  }

  const rooms = $derived(options("rooms"));
  const functions = $derived(options("functions"));
  const favorites = $derived(options("favorites"));

  const active = $derived(!!(chips.room || chips.function || chips.favorite));

  function set(key: keyof FilterChips, value: string) {
    onChange({ ...chips, [key]: value || undefined });
  }
</script>

<div class="chips">
  {#if rooms.length}
    <label class="chip">
      <span class="sr-only">Room</span>
      <select
        value={chips.room ?? ""}
        onchange={(e) => set("room", e.currentTarget.value)}
      >
        <option value="">All rooms</option>
        {#each rooms as r (r.id)}
          <option value={r.id}>{r.label}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if functions.length}
    <label class="chip">
      <span class="sr-only">Function</span>
      <select
        value={chips.function ?? ""}
        onchange={(e) => set("function", e.currentTarget.value)}
      >
        <option value="">All functions</option>
        {#each functions as f (f.id)}
          <option value={f.id}>{f.label}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if favorites.length}
    <label class="chip">
      <span class="sr-only">Favorite</span>
      <select
        value={chips.favorite ?? ""}
        onchange={(e) => set("favorite", e.currentTarget.value)}
      >
        <option value="">All favorites</option>
        {#each favorites as f (f.id)}
          <option value={f.id}>{f.label}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if active}
    <button
      type="button"
      class="clear"
      title="Clear filters"
      aria-label="Clear filters"
      onclick={() => onChange({})}
    >
      <span class="material-symbols-outlined" aria-hidden="true"
        >filter_alt_off</span
      >
    </button>
  {/if}
</div>

<style>
  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .chip select {
    max-width: 11rem;
    padding: 3px 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    background-color: var(--surface-container-lowest);
    color: var(--text-color);
    font-size: 12px;
  }

  .clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .clear:hover {
    color: var(--text-color);
    background-color: var(--surface-container);
  }

  .clear .material-symbols-outlined {
    font-size: 16px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
