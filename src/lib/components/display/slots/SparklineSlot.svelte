<script lang="ts">
  import { sparklinePoints } from "$lib/config/history-ops";
  import {
    ensureHistory,
    noteLive,
    readHistory,
  } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import type { EnrichedControl } from "$lib/types/device";

  let { control }: { control: EnrichedControl } = $props();

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
  const points = $derived(
    entry && entry.series.length
      ? sparklinePoints(entry.series, 120, 28, 2)
      : "",
  );
</script>

{#if spec && control.stateId}
  {#if points}
    <svg class="spark" viewBox="0 0 120 28" aria-hidden="true">
      <polyline {points} fill="none" />
    </svg>
  {:else}
    <span class="spark-placeholder text-muted" aria-hidden="true">
      {entry?.status === "error" ? "!" : "…"}
    </span>
  {/if}
{/if}

<style>
  .spark {
    display: block;
    width: 100%;
    max-width: 140px;
    height: 28px;
    /* currentColor: the token is --primary-color, and a wrong name would make
       the polyline vanish rather than fall back. */
    color: var(--primary-color, #007bff);
  }

  .spark polyline {
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .spark-placeholder {
    font-size: var(--body-sm);
  }
</style>
