<script lang="ts">
  import { backgroundCss } from "$lib/config/appearance";
  import type { Group, Size } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";
  import type { ResolvedTile } from "$lib/config/pages-ops";
  import type { Breakpoint } from "$lib/config/size-ops";
  import Tile from "./Tile.svelte";

  let {
    group,
    tiles,
    bp,
  }: {
    group: Group;
    tiles: ResolvedTile<EnrichedDevice & { size?: Size }>[];
    bp: Breakpoint;
  } = $props();
</script>

<section
  class="group"
  class:bordered={group.appearance?.border === true}
  style={group.appearance?.background
    ? backgroundCss(group.appearance.background)
    : ""}
>
  {#if group.title}
    <h2 class="group-title">
      {#if group.icon}<span class="material-symbols-outlined" aria-hidden="true"
          >{group.icon}</span
        >{/if}
      <span>{group.title}</span>
    </h2>
  {/if}

  <div class="grid">
    {#each tiles as t (t.placement.id)}
      <Tile
        device={t.device}
        {bp}
        title={t.placement.title}
        tile={t.placement.tile}
      />
    {/each}
  </div>
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    /* A flow item: as wide as its tiles need and no wider, so the next section
       starts right after it. No grow — a section never stretches to fill the
       space beside it. */
    flex: 0 1 auto;
    min-width: min(100%, var(--tile-w, 57px));
    max-width: 100%;
  }

  /* `appearance.border: true` draws the section's box; absent is today's look. */
  .group.bordered {
    padding: 4px 6px 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
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

  .grid {
    display: grid;
    gap: 6px;
    /* Half-width columns + full-height rows: `w: 1` is a half-width card. */
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-w, 57px), 1fr));
    /* The row height is a *minimum*: a tile with more content grows rather than
       clipping its values (font and icon sizes never shrink). */
    grid-auto-rows: minmax(var(--tile-h, 114px), auto);
  }
</style>
