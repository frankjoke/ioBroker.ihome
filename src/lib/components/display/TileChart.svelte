<script lang="ts">
  import { durationMs, seriesPoints } from "$lib/config/history-ops";
  import { splitReading } from "$lib/config/format";
  import type { ChartSeries } from "$lib/config/tile-parts";
  import {
    ensureHistory,
    noteLive,
    readHistory,
  } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let {
    series,
    wide = false,
    area = false,
    decimals,
  }: {
    series: ChartSeries[];
    wide?: boolean;
    area?: boolean;
    /** Min/max label precision; absent → the slot's decimals, else 1. */
    decimals?: number;
  } = $props();

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
      return {
        color: s.color,
        spec,
        points: entry?.series ?? [],
        unit: s.control.meta?.unit ?? s.control.unit,
        decimals:
          typeof s.slot.options?.decimals === "number"
            ? s.slot.options.decimals
            : undefined,
      };
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
      .map((l) => {
        const values = l.points
          .map((point) => point.val)
          .filter(
            (value): value is number =>
              typeof value === "number" && Number.isFinite(value),
          );
        return {
          color: l.color,
          points: seriesPoints(l.points, {
            from,
            to: end,
            width: 120,
            height: 28,
          }),
          min: values.length ? Math.min(...values) : undefined,
          max: values.length ? Math.max(...values) : undefined,
          unit: l.unit,
          decimals: l.decimals,
        };
      })
      .filter((l) => l.points);
  });

  /** The first line is the tile's main series; label that one only, because
   *  several lines can carry different units. */
  const range = $derived.by(() => {
    const first = drawn[0];
    if (!first || first.min === undefined || first.max === undefined) {
      return undefined;
    }
    // Chart precision wins, then the slot's own, then one decimal.
    const precision = decimals ?? first.decimals ?? 1;
    const min = splitReading(first.min, first.unit, precision);
    const max = splitReading(first.max, first.unit, precision);
    return {
      min: min.unit ? `${min.value} ${min.unit}` : min.value,
      max: max.unit ? `${max.value} ${max.unit}` : max.value,
    };
  });

  /** One gradient per colour; shared charts can reuse the same identical one. */
  const areaColors = $derived([...new Set(drawn.map((l) => l.color))]);
  const colorId = (color: string) =>
    `area-${String(color)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()}`;

  /** The line's points and the baseline, closed into a filled path. */
  function areaPath(points: string): string {
    const pairs = points
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((pair) => pair.split(",").map(Number));
    if (!pairs.length) return "";
    const first = pairs[0][0];
    const last = pairs[pairs.length - 1][0];
    return `M ${pairs.map(([x, y]) => `${x},${y}`).join(" L ")} L ${last},28 L ${first},28 Z`;
  }
</script>

{#if drawn.length}
  <div class="chart-wrap">
    <svg
      class="chart"
      class:wide
      viewBox="0 0 120 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {#if area}
        <defs>
          {#each areaColors as color (color)}
            <linearGradient id={colorId(color)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style:stop-color={color} stop-opacity="0.3" />
              <stop offset="1" style:stop-color={color} stop-opacity="0" />
            </linearGradient>
          {/each}
        </defs>
      {/if}
      <!-- Reversed: the first series is the tile's main line, so it paints last
         and stays visible on top of the others. -->
      {#each [...drawn].reverse() as l, i (i)}
        {#if area}
          <path
            class="area"
            d={areaPath(l.points)}
            fill={`url(#${colorId(l.color)})`}
          />
        {/if}
        <polyline points={l.points} style:stroke={l.color} />
      {/each}
    </svg>
    {#if wide && range}
      <span class="chart-min">{range.min}</span>
      <span class="chart-max">{range.max}</span>
    {/if}
  </div>
{/if}

<style>
  .chart-wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .chart {
    display: block;
    width: 100%;
    max-width: 140px;
    height: 28px;
    margin-inline: auto;
  }

  /* The main line's range, quiet at the chart's corners. */
  .chart-min,
  .chart-max {
    position: absolute;
    font-family: var(--ui-font-value, var(--font-family));
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: var(--text-muted);
    white-space: nowrap;
    pointer-events: none;
  }

  .chart-min {
    left: 0;
    bottom: 1px;
  }

  .chart-max {
    right: 0;
    top: 1px;
    text-align: right;
  }

  .chart.wide {
    max-width: none;
    height: 100%;
  }

  .chart .area {
    stroke: none;
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
