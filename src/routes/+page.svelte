<script lang="ts">
  import DisplayBar from "$lib/components/display/DisplayBar.svelte";
  import PageView from "$lib/components/display/PageView.svelte";
  import { getPageRegistry, view } from "$lib/stores/pages.svelte.js";

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

<div class="display">
  <DisplayBar currentId={current?.id} />

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

<style>
  .display {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }
</style>
