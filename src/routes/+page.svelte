<script lang="ts">
  import PageView from "$lib/components/display/PageView.svelte";
  import LayoutSheet from "$lib/components/layout/LayoutSheet.svelte";
  import {
    getPageRegistry,
    setLastPage,
    view,
  } from "$lib/stores/pages.svelte.js";
  import { sheet } from "$lib/stores/sheet.svelte.js";
  import { placementAt } from "$lib/config/tile-hit";
  import type { PlacementAnchor } from "$lib/config/layout-ops";

  const pages = $derived(getPageRegistry().pages ?? []);
  // A wall tablet reboots on the page you left it on; a page that no longer
  // exists falls back to the first one.
  const current = $derived(
    pages.find((p) => p.id === view.lastPage) ?? pages[0],
  );

  /** The tile the last click in the display landed on (A48). */
  let picked = $state<PlacementAnchor | null>(null);
</script>

<svelte:head>
  <title>iHome</title>
</svelte:head>

<div class="display" class:editing={sheet.open}>
  {#if current}
    {#key current.id}
      <PageView page={current} />
    {/key}
  {:else}
    <p class="empty text-muted">
      No pages yet. They are created from your rooms and functions on first
      load.
    </p>
  {/if}

  <!-- The display is a preview while the sheet is open: this layer takes every
       press before a tile can, so no lamp switches and no long-press fires
       (A43) — and a press on a tile hands its placement to the sheet (A48).
       A gap or a heading answers null and selects nothing. -->
  {#if sheet.open}
    <button
      type="button"
      class="pick-layer"
      aria-label="Select a tile in the display"
      onclick={(e) => {
        picked = placementAt(document.elementsFromPoint(e.clientX, e.clientY));
      }}
    ></button>
  {/if}
</div>

<!-- The editor is a mode of this page, not a place you go: the sheet opens over
     the display, and the display's page is the sheet's page (A43/A45). -->
{#if sheet.open && current}
  <LayoutSheet
    pageId={current.id}
    onPage={setLastPage}
    onClose={() => (sheet.open = false)}
    {picked}
  />
{/if}

<style>
  .display {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* The display's selection layer (A48): transparent, over every tile, under
     the sheet (z 40). It is the whole of the display's inertness (A43) — a
     press can only report what it landed on, never act on it. */
  .pick-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  /* Wide: the sheet takes the right-hand strip, the display keeps the rest (it
     reflows to whatever width it gets). Narrow: the sheet is a bottom sheet and
     the display keeps the top strip. */
  @media (min-width: 821px) {
    .display.editing {
      padding-right: 440px;
    }
  }

  @media (max-width: 820px) {
    .display.editing {
      padding-bottom: 62vh;
    }
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }
</style>
