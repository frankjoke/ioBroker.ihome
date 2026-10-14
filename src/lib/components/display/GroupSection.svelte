<script lang="ts">
  import { clampSpan, type Breakpoint } from "$lib/config/size-ops";
  import type { Group, Size } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";
  import Tile from "./Tile.svelte";

  let {
    group,
    devices,
    bp,
  }: {
    group: Group;
    devices: (EnrichedDevice & { size?: Size })[];
    bp: Breakpoint;
  } = $props();
</script>

<section class="group">
  {#if group.title}
    <h2 class="group-title">
      {#if group.icon}<span class="material-symbols-outlined" aria-hidden="true"
          >{group.icon}</span
        >{/if}
      <span>{group.title}</span>
      <span class="count">{devices.length}</span>
    </h2>
  {/if}

  <div class="grid">
    {#each devices as d (d.id)}
      <Tile device={d} {bp} />
    {/each}
  </div>
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

  .group-title .material-symbols-outlined {
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
    grid-template-columns: repeat(
      auto-fill,
      minmax(var(--tile-min, 190px), 1fr)
    );
    grid-auto-rows: var(--tile-min, 190px);
  }
</style>
