<script lang="ts">
  import { onMount } from "svelte";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import {
    filterDevices,
    resolvePage,
    toFilterable,
    type FilterableDevice,
  } from "$lib/config/pages-ops";
  import { view } from "$lib/stores/pages.svelte.js";
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
  const def = $derived(
    BREAKPOINTS.find((b) => b.name === bp) ?? BREAKPOINTS[0],
  );

  type DisplayDevice = EnrichedDevice & FilterableDevice;

  const devices = $derived<DisplayDevice[]>(
    $devicesEnrichedStore.map((d) => toFilterable(d)) as DisplayDevice[],
  );
  // Chips narrow what the groups see; a group that empties out disappears
  // unless it asks for empties (resolvePage handles that).
  const visible = $derived(filterDevices(devices, view.chips));
  const groups = $derived(resolvePage(page, visible));
  const filtered = $derived(
    !!(view.chips.room || view.chips.function || view.chips.favorite),
  );
  const matchCount = $derived(groups.reduce((n, g) => n + g.devices.length, 0));

  const pageStyle = $derived(
    `--tile-w: ${def.tileW}px; --tile-h: ${def.tileH}px; ${backgroundCss(page.background)}`,
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
  {#if filtered}
    <p class="count text-muted">
      {matchCount}
      {matchCount === 1 ? "device" : "devices"}
    </p>
  {/if}

  {#if groups.length === 0}
    <p class="empty text-muted">
      {filtered
        ? "No devices match the filters."
        : "This page has no devices yet."}
    </p>
  {/if}

  {#each groups as g (g.group.id)}
    <GroupSection group={g.group} devices={g.devices} {bp} pageId={page.id} />
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

  .count {
    margin: 0;
    font-size: var(--body-sm);
    font-variant-numeric: tabular-nums;
  }
</style>
