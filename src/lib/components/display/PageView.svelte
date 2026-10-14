<script lang="ts">
  import { onMount } from "svelte";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import {
    resolvePage,
    toFilterable,
    type FilterableDevice,
  } from "$lib/config/pages-ops";
  import {
    BREAKPOINTS,
    breakpointFor,
    type Breakpoint,
  } from "$lib/config/size-ops";
  import GroupSection from "./GroupSection.svelte";
  import type { Background, Page } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";

  let { page }: { page: Page } = $props();

  let width = $state(1400);
  onMount(() => {
    const onResize = () => (width = window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  const bp = $derived<Breakpoint>(breakpointFor(width));
  const tileMin = $derived(
    BREAKPOINTS.find((b) => b.name === bp)?.tileMin ?? 190,
  );

  type DisplayDevice = EnrichedDevice & FilterableDevice;

  const devices = $derived<DisplayDevice[]>(
    $devicesEnrichedStore.map((d) => toFilterable(d)) as DisplayDevice[],
  );
  const groups = $derived(resolvePage(page, devices));

  const pageStyle = $derived(
    `--tile-min: ${tileMin}px; ${backgroundCss(page.background)}`,
  );

  function backgroundCss(bg: Background | undefined): string {
    if (!bg?.value) return "";
    if (bg.kind === "image") {
      return `background-image: url("${bg.value}"); background-size: cover; background-attachment: fixed;`;
    }
    if (bg.kind === "gradient") {
      return `background-image: ${bg.value}; background-attachment: fixed;`;
    }
    return `background-color: ${bg.value};`;
  }
</script>

<div class="page" style={pageStyle}>
  {#if groups.length === 0}
    <p class="empty text-muted">This page has no devices yet.</p>
  {/if}

  {#each groups as g (g.group.id)}
    <GroupSection group={g.group} devices={g.devices} {bp} />
  {/each}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-height: 100vh;
    padding: 12px;
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }
</style>
