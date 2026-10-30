<script lang="ts">
  import { formatAge, splitReading } from "$lib/config/format";
  import { normalizeStates } from "$lib/config/state-meta";
  import {
    ensureHistory,
    noteLive,
    readHistory,
  } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import type { EnrichedControl } from "$lib/types/device";

  let { control, count = 4 }: { control: EnrichedControl; count?: number } =
    $props();

  const spec = $derived(control.history);

  $effect(() => {
    if (!control.stateId || !spec) return;
    ensureHistory(ioBroker, control.stateId, spec);
    // Feed live samples, or a tablet left open keeps drawing the fetched range.
    const st: any = (ioBroker.states as any)?.get(control.stateId);
    if (st && typeof st.ts === "number" && Number.isFinite(st.val)) {
      noteLive(control.stateId, spec, { ts: st.ts, val: st.val });
    }
  });

  const entry = $derived(
    control.stateId && spec ? readHistory(control.stateId, spec) : undefined,
  );
  // Newest first — the last N samples.
  const rows = $derived(
    entry?.series?.length ? entry.series.slice(-count).reverse() : [],
  );

  /** A sample with the effective unit and states label. */
  function reading(v: unknown): string {
    const parts = splitReading(
      v,
      control.meta?.unit ?? control.unit,
      undefined,
      normalizeStates(control.meta?.states ?? control.states),
    );
    return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
  }
</script>

{#if spec && rows.length}
  <ul class="history-list">
    {#each rows as p (p.ts)}
      <li>
        <span class="ago text-muted">{formatAge(p.ts)}</span>
        <span class="val mono">{reading(p.val)}</span>
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
