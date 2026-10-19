<script lang="ts">
  import PageView from "$lib/components/display/PageView.svelte";
  import LayoutSheet from "$lib/components/layout/LayoutSheet.svelte";
  import {
    getPageRegistry,
    setLastPage,
    view,
  } from "$lib/stores/pages.svelte.js";
  import { sheet } from "$lib/stores/sheet.svelte.js";
  import { placementUnder } from "$lib/config/tile-hit";
  import type { PlacementAnchor } from "$lib/config/layout-ops";

  const pages = $derived(getPageRegistry().pages ?? []);
  // A wall tablet reboots on the page you left it on; a page that no longer
  // exists falls back to the first one.
  const current = $derived(
    pages.find((p) => p.id === view.lastPage) ?? pages[0],
  );

  /** The tile the last click in the display landed on (A48). */
  let picked = $state<PlacementAnchor | null>(null);

  function pick(event: MouseEvent): void {
    // The tiles are inside the inert stage, so they cannot be hit-tested: the
    // boxes are walked instead (the layer is the only target there is).
    const hit = placementUnder(
      [...document.querySelectorAll(".stage [data-placement-id]")],
      event.clientX,
      event.clientY,
    );
    if (!hit) return;
    // The cursor's page is the display's page (A45), so the page moves here —
    // one state write, in the click, not an effect reading the display's page
    // it would then re-apply on every later page change.
    setLastPage(hit.pageId);
    picked = hit;
  }

  // A pick is spent when the sheet closes: reopening must not jump back to the
  // old tile, and a stale pick must not clobber a handoff that arrives with a
  // fresh sheet (the bug 3911929 fixed).
  $effect(() => {
    if (!sheet.open) picked = null;
  });
</script>

<svelte:head>
  <title>iHome</title>
</svelte:head>

<div class="display" class:editing={sheet.open}>
  {#if current}
    <!-- The display is a picture while the sheet is open (A43): inert takes it
         out of reach of keyboard as well as pointer — the pick layer below is
         the only thing a press can land on. -->
    <div class="stage" inert={sheet.open}>
      {#key current.id}
        <PageView page={current} />
      {/key}
    </div>
  {:else}
    <p class="empty text-muted">
      No pages yet. They are created from your rooms and functions on first
      load.
    </p>
  {/if}

  <!-- The selection layer (A48): transparent, over every tile, under the sheet
       (z 40) and outside the inert stage. A press on a tile hands its placement
       to the sheet; a gap or a heading answers null and selects nothing. It is
       not a control — pointer only, so no tab stop and nothing to announce. -->
  {#if sheet.open}
    <button
      type="button"
      class="pick-layer"
      tabindex="-1"
      aria-hidden="true"
      onclick={pick}
    ></button>
  {/if}
</div>

<!-- The editor is a mode of this page, not a place you go: the sheet opens over
     the display, and the display's page is the sheet's page (A43/A45). It also
     mounts with no page at all — that is where "Add page" lives (A44). -->
{#if sheet.open}
  <LayoutSheet
    pageId={current?.id ?? ""}
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
