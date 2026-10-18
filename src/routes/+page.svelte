<script lang="ts">
  import PageView from "$lib/components/display/PageView.svelte";
  import LayoutSheet from "$lib/components/layout/LayoutSheet.svelte";
  import {
    getPageRegistry,
    setLastPage,
    view,
  } from "$lib/stores/pages.svelte.js";
  import { sheet } from "$lib/stores/sheet.svelte.js";

  const pages = $derived(getPageRegistry().pages ?? []);
  // A wall tablet reboots on the page you left it on; a page that no longer
  // exists falls back to the first one.
  const current = $derived(
    pages.find((p) => p.id === view.lastPage) ?? pages[0],
  );
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
</div>

<!-- The editor is a mode of this page, not a place you go: the sheet opens over
     the display, and the display's page is the sheet's page (A43/A45). -->
{#if sheet.open && current}
  <LayoutSheet
    pageId={current.id}
    onPage={setLastPage}
    onClose={() => (sheet.open = false)}
  />
{/if}

<style>
  .display {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
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
