<script lang="ts">
  import { formatAge, formatValue } from "$lib/config/format";
  import { ensureHistory, readHistory } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import type { EnrichedControl } from "$lib/types/device";

  let { control, count = 4 }: { control: EnrichedControl; count?: number } =
    $props();

  const spec = $derived(control.history);

  $effect(() => {
    if (!control.stateId || !spec) return;
    ensureHistory(ioBroker, control.stateId, spec);
  });

  const entry = $derived(
    control.stateId && spec ? readHistory(control.stateId, spec) : undefined,
  );
  // Newest first — the last N samples.
  const rows = $derived(
    entry?.series?.length ? entry.series.slice(-count).reverse() : [],
  );
</script>

{#if spec && rows.length}
  <ul class="history-list">
    {#each rows as p (p.ts)}
      <li>
        <span class="ago text-muted">{formatAge(p.ts)}</span>
        <span class="val mono">{formatValue(p.val, control.unit)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .history-list li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: var(--body-sm);
  }

  .ago {
    font-size: 11px;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
    white-space: nowrap;
  }
</style>
