<script lang="ts">
  import { page as route } from "$app/state";
  import DisplayPage from "$lib/components/display/DisplayPage.svelte";
  import { getPageRegistry, setLastPage } from "$lib/stores/pages.svelte.js";

  const pages = $derived(getPageRegistry().pages ?? []);
  // An unknown id falls back to the first page rather than showing nothing —
  // a bookmark to a deleted page should still land somewhere useful (spec §3).
  const current = $derived(
    pages.find((p) => p.id === route.params?.id) ?? pages[0],
  );

  // The root route ("/") shows the page the wall was last on, so a direct
  // visit here is what "last" means from now on.
  $effect(() => {
    if (current) setLastPage(current.id);
  });
</script>

<svelte:head>
  <title>{current ? `${current.title} - iHome` : "iHome"}</title>
</svelte:head>

<DisplayPage page={current} />
