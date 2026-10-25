<script lang="ts">
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import DisplayPage from "$lib/components/display/DisplayPage.svelte";
  import {
    getPageRegistry,
    renamedPageIds,
    setLastPage,
  } from "$lib/stores/pages.svelte.js";

  const pages = $derived(getPageRegistry().pages ?? []);
  // An unknown id falls back to the first page rather than showing nothing —
  // a bookmark to a deleted page should still land somewhere useful (spec §3).
  const current = $derived(
    pages.find((p) => p.id === route.params?.id) ?? pages[0],
  );

  // A link from before the readable-id migration still works while its rename
  // is in this session: generated ids were renamed to the title's slug on load.
  $effect(() => {
    void pages; // the rename map is filled when the document arrives
    const renamed = renamedPageIds()[route.params?.id ?? ""];
    if (renamed) void goto(`#/p/${renamed}`, { replaceState: true });
  });

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
