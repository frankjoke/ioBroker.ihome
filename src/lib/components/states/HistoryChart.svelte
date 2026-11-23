<script lang="ts">
  let {
    points,
    height = 160,
  }: {
    points: Array<{ ts: number; val: number }>;
    height?: number;
  } = $props();

  const width = 600;
  const pad = 8;

  const chart = $derived.by(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => point.val);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const from = points[0].ts;
    const to = points[points.length - 1].ts;
    const span = to - from || 1;
    const x = (ts: number) => pad + ((ts - from) / span) * (width - pad * 2);
    const y = (value: number) =>
      height - pad - ((value - min) / (max - min)) * (height - pad * 2);
    return {
      polyline: points
        .map((point) => `${x(point.ts)},${y(point.val)}`)
        .join(" "),
      min,
      max,
      from,
      to,
    };
  });
</script>

{#if chart}
  <div class="chart">
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Stored history"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="var(--primary-color)"
        stroke-width="1.5"
        points={chart.polyline}
      />
    </svg>
    <div class="range text-muted">
      <span>{new Date(chart.from).toLocaleString()}</span>
      <span
        >min {chart.min.toLocaleString()} · max {chart.max.toLocaleString()}</span
      >
      <span>{new Date(chart.to).toLocaleString()}</span>
    </div>
  </div>
{:else}
  <p class="hint text-muted">No data in this range.</p>
{/if}

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  svg {
    width: 100%;
    height: 160px;
    background: var(--surface-container-low);
    border-radius: var(--border-radius);
  }

  .range {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: var(--body-sm);
    flex-wrap: wrap;
  }
</style>
