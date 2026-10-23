<script lang="ts">
  import DisplayPage from "$lib/components/display/DisplayPage.svelte";
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

<DisplayPage page={current} />
