<script lang="ts">
  import { page as route } from "$app/state";
  import DisplayBar from "$lib/components/display/DisplayBar.svelte";
  import PageView from "$lib/components/display/PageView.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";

  const pages = $derived(getPageRegistry().pages ?? []);
  // An unknown id falls back to the first page rather than showing nothing —
  // a bookmark to a deleted page should still land somewhere useful (spec §3).
  const current = $derived(
    pages.find((p) => p.id === route.params?.id) ?? pages[0],
  );
</script>

<svelte:head>
  <title>{current ? `${current.title} - iHome` : "iHome"}</title>
</svelte:head>

<div class="display">
  <DisplayBar currentId={current?.id} />

  {#if current}
    {#key current.id}
      <PageView page={current} />
    {/key}
  {:else}
    <p class="empty text-muted">No pages yet.</p>
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
