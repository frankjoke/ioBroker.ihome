<script lang="ts">
  import { backgroundCss } from "$lib/config/appearance";
  import { resolvePage, type ResolvedTile } from "$lib/config/pages-ops";
  import { layoutSection, modulesFor } from "$lib/config/section-layout";
  import { effectiveSpan } from "$lib/config/template-ops";
  import {
    BREAKPOINTS,
    breakpointFor,
    type Breakpoint,
  } from "$lib/config/size-ops";
  import { effectiveUi, scaledTile } from "$lib/config/ui-settings";
  import { getSettings } from "$lib/stores/settings.svelte";
  import GroupSection from "./GroupSection.svelte";
  import type { Page } from "$lib/types/display";

  let { page }: { page: Page } = $props();

  // The breakpoint follows the *container*, not the window: the display is the
  // whole window on the wall, but the layout sheet renders it beside/in front of
  // an editor, and it must reflow into what it actually gets.
  let width = $state(1400);

  const bp = $derived<Breakpoint>(breakpointFor(width));
  const def = $derived(
    BREAKPOINTS.find((b) => b.name === bp) ?? BREAKPOINTS[0],
  );

  // A section renders its placements, in order — not the filter it came from (A8).
  const groups = $derived(resolvePage(page));

  const ui = $derived(effectiveUi(getSettings()));
  /** The 1×1 module at the installation's scale (ui-settings.ts). */
  const moduleSize = $derived(scaledTile(def, ui.tileScale));

  // How many tile modules fit on one line at this width — the page's own padding
  // (8px each side) and the grid gap (6px), matching the CSS below.
  const maxModules = $derived(modulesFor(width, moduleSize.w, 6, 24));
  /** A tile's width in modules — the *same* calculation the tile renders with. */
  const spanOf = (t: ResolvedTile): number =>
    effectiveSpan(t.placement.tile, bp).w;
  // The pass interprets the tree: which row/column each tile gets, and how wide
  // each section is (as wide as its tiles need).
  const sections = $derived(
    groups.map((g) => layoutSection(g.group, g.tiles, spanOf, maxModules)),
  );

  const pageStyle = $derived(
    `--tile-w: ${moduleSize.w}px; --tile-h: ${moduleSize.h}px; ${backgroundCss(page.background)}`,
  );
</script>

<div class="page" style={pageStyle} bind:clientWidth={width}>
  {#if groups.length === 0}
    <p class="empty text-muted">This page has no devices yet.</p>
  {/if}

  {#each sections as s (s.group.id)}
    {#if s.group.newLine}
      <!-- A full-width, zero-height item: it pushes everything after it onto a
           new line, and the section keeps its own width (review I6). -->
      <div class="break" aria-hidden="true"></div>
    {/if}
    <GroupSection
      group={s.group}
      tiles={s.tiles}
      modules={s.modules}
      {bp}
      pageId={page.id}
    />
  {/each}
</div>

<style>
  .page {
    /* Sections flow: as many per row as the width allows, the rest wrap. A
       phone stacks them (base breakpoint — the same 600px size-ops uses). */
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    /* Lines keep their content height; without this the 100vh min-height
       stretches the lines and leaves a blank band before the next row. */
    align-content: flex-start;
    gap: 1.25rem;
    min-height: 100vh;
    padding: 8px;
    /* A User Interface default (ui-settings.ts); an explicit page background
       is inline and wins. */
    background-color: var(--ui-page-bg, transparent);
  }

  /* A `newLine` section is preceded by this: full width, no height, so the
     section itself starts on a fresh line at its own width. */
  .break {
    flex-basis: 100%;
    height: 0;
    margin: 0;
  }

  @media (max-width: 599px) {
    .page {
      flex-direction: column;
    }
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }
</style>
