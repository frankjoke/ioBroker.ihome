<script lang="ts">
  import DisplayBar from "$lib/components/display/DisplayBar.svelte";
  import PageView from "$lib/components/display/PageView.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";

  const pages = $derived(getPageRegistry().pages ?? []);
  const current = $derived(pages[0]);
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
