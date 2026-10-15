<script lang="ts">
  import { onMount } from "svelte";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import { backgroundCss } from "$lib/config/appearance";
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
  import type { Page } from "$lib/types/display";
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
  // A section renders its placements, in order — not the filter it came from (A8).
  const groups = $derived(resolvePage(page, visible));
  const filtered = $derived(
    !!(view.chips.room || view.chips.function || view.chips.favorite),
  );
  const matchCount = $derived(groups.reduce((n, g) => n + g.tiles.length, 0));

  const pageStyle = $derived(
    `--tile-w: ${def.tileW}px; --tile-h: ${def.tileH}px; ${backgroundCss(page.background)}`,
  );
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
    <GroupSection group={g.group} tiles={g.tiles} {bp} />
  {/each}
</div>

<style>
  .page {
    /* Sections flow: as many per row as the width allows, the rest wrap. A
       phone stacks them (base breakpoint — the same 600px size-ops uses). */
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1.25rem;
    min-height: 100vh;
    padding: 12px;
  }

  @media (max-width: 599px) {
    .page {
      flex-direction: column;
    }
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
