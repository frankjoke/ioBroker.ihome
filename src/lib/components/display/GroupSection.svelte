<script lang="ts">
  import { backgroundCss } from "$lib/config/appearance";
  import type { Group, Size } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";
  import type { ResolvedTile } from "$lib/config/pages-ops";
  import type { Breakpoint } from "$lib/config/size-ops";
  import { requestLayoutConfig, wantsDeviceConfig } from "$lib/pages.js";
  import { openSheetGated } from "$lib/stores/sheet.svelte.js";
  import Icon from "$lib/components/common/Icon.svelte";
  import Tile from "./Tile.svelte";

  let {
    group,
    tiles,
    modules = 0,
    bp,
    pageId,
  }: {
    group: Group;
    tiles: ResolvedTile<EnrichedDevice & { size?: Size }>[];
    /** The section's width in tile modules from the layout pass; 0 → fluid. */
    modules?: number;
    bp: Breakpoint;
    pageId: string;
  } = $props();

  /**
   * The section is exactly as wide as its tiles need (the pass decided), plus
   * its own decoration: a bordered section subtracts border and padding from that
   * width (`box-sizing: border-box`), so they have to be added back or the grid
   * spills out of the border (review I5).
   */
  const decoration = $derived(group.appearance?.border === true ? 14 : 0);
  const width = $derived(
    modules > 0
      ? `width: calc(${modules} * var(--tile-w, 57px) + ${modules - 1} * 6px + ${decoration}px);`
      : "",
  );
  const background = $derived(
    group.appearance?.background
      ? backgroundCss(group.appearance.background)
      : "",
  );

  /** Ctrl/Cmd+click the section header → open this section in the layout
   *  editor. A gated entrance: the pencil lock asks for the PIN first. */
  function onTitleClick(event: MouseEvent) {
    if (!wantsDeviceConfig(event)) return;
    event.preventDefault();
    event.stopPropagation();
    requestLayoutConfig({ pageId, sectionId: group.id });
    openSheetGated();
  }
</script>

<section
  class="group"
  class:bordered={group.appearance?.border === true}
  class:new-line={group.newLine === true}
  style="{background} {width}"
>
  {#if group.title}
    <!-- Ctrl/Cmd+click is a power-user shortcut on a heading, not a control; the
         layout editor stays reachable via the AppBar pencil, so no key handler. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <h2 class="group-title" onclick={onTitleClick}>
      {#if group.icon}<span class="group-icon"
          ><Icon value={group.icon} size={18} /></span
        >{/if}
      <span>{group.title}</span>
    </h2>
  {/if}

  <div
    class="grid"
    style={modules > 0
      ? `grid-template-columns: repeat(${modules}, var(--tile-w, 57px));`
      : ""}
  >
    {#each tiles as t (t.placement.id)}
      <Tile
        device={t.device}
        {bp}
        title={t.placement.title}
        tile={t.placement.tile}
        newLine={t.placement.newLine === true}
        anchor={{ pageId, sectionId: group.id, placementId: t.placement.id }}
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

  .group-icon {
    display: inline-flex;
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
