<script lang="ts">
  import { durationMs, seriesPoints } from "$lib/config/history-ops";
  import type { ChartSeries } from "$lib/config/tile-parts";
  import {
    ensureHistory,
    noteLive,
    readHistory,
  } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let { series }: { series: ChartSeries[] } = $props();

  // Fetch and feed every series (the store dedupes per state + spec), so the
  // tile chart and a row chart read one cache.
  $effect(() => {
    for (const s of series) {
      const spec = s.control.history;
      const id = s.control.stateId;
      if (!spec || !id) continue;
      ensureHistory(ioBroker, id, spec);
      // Live samples, or a tablet left open keeps drawing the fetched range.
      const st: any = (ioBroker.states as any)?.get(id);
      if (st && typeof st.ts === "number" && Number.isFinite(st.val)) {
        noteLive(id, spec, { ts: st.ts, val: st.val });
      }
    }
  });

  /** The polylines, each on the shared window (A61): x by time across the
   *  widest of the series' own windows, so a shorter history sits at the right
   *  and differently sampled series line up. A series with nothing yet draws
   *  nothing — the others still do. The window ends at the newest sample (not
   *  at `Date.now()`): a stale series then has no dead right margin — do not
   *  "fix" it back to now. */
  const drawn = $derived.by(() => {
    const loaded = series.map((s) => {
      const spec = s.control.history;
      const entry =
        spec && s.control.stateId
          ? readHistory(s.control.stateId, spec)
          : undefined;
      return { color: s.color, spec, points: entry?.series ?? [] };
    });
    let to = 0;
    let span = 0;
    for (const l of loaded) {
      if (l.points.length) to = Math.max(to, l.points[l.points.length - 1].ts);
      if (l.spec) span = Math.max(span, durationMs(l.spec));
    }
    const end = to || Date.now();
    const from = end - span;
    return loaded
      .map((l) => ({
        color: l.color,
        points: seriesPoints(l.points, {
          from,
          to: end,
          width: 120,
          height: 28,
        }),
      }))
      .filter((l) => l.points);
  });
</script>

{#if drawn.length}
  <svg
    class="chart"
    viewBox="0 0 120 28"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <!-- Reversed: the first series is the tile's main line, so it paints last
         and stays visible on top of the others. -->
    {#each [...drawn].reverse() as l, i (i)}
      <polyline points={l.points} style:stroke={l.color} />
    {/each}
  </svg>
{/if}

<style>
  .chart {
    display: block;
    width: 100%;
    max-width: 140px;
    height: 28px;
  }

  .chart polyline {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    /* A stretched viewBox would thin the line; keep it one pixel whatever the
       box is. */
    vector-effect: non-scaling-stroke;
  }
</style>
