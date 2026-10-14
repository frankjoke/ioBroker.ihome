<script lang="ts">
  import { clampSpan, type Breakpoint } from "$lib/config/size-ops";
  import type { Group, Size } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";
  import { isCollapsed, toggleCollapsed } from "$lib/stores/pages.svelte.js";
  import Tile from "./Tile.svelte";

  let {
    group,
    devices,
    bp,
    pageId,
  }: {
    group: Group;
    devices: (EnrichedDevice & { size?: Size })[];
    bp: Breakpoint;
    pageId: string;
  } = $props();

  // Collapsed state is view state, per page+group, remembered in localStorage.
  const collapsed = $derived(isCollapsed(pageId, group.id));
</script>

<section class="group">
  {#if group.title}
    <h2 class="group-title">
      <button
        type="button"
        class="title-toggle"
        aria-expanded={!collapsed}
        onclick={() => toggleCollapsed(pageId, group.id)}
      >
        <span class="material-symbols-outlined" aria-hidden="true"
          >{collapsed ? "chevron_right" : "expand_more"}</span
        >
        {#if group.icon}<span
            class="material-symbols-outlined"
            aria-hidden="true">{group.icon}</span
          >{/if}
        <span>{group.title}</span>
        <span class="count">{devices.length}</span>
      </button>
    </h2>
  {/if}

  {#if !collapsed}
    <div class="grid">
      {#each devices as d (d.id)}
        <Tile device={d} {bp} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .group-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.25rem 0 0;
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .title-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 2px 6px 2px 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .title-toggle .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
  }

  .group-title .count {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    background-color: var(--surface-container);
    border-radius: var(--border-radius-pill);
    padding: 1px 8px;
  }

  .grid {
    display: grid;
    gap: 8px;
    /* Half-width columns + full-height rows: `w: 1` is a half-width card. */
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-w, 95px), 1fr));
    grid-auto-rows: var(--tile-h, 190px);
  }
</style>
