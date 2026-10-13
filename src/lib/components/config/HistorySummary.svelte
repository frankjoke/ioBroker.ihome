<script lang="ts">
  import type { Control } from "$lib/types/device";
  import {
    durationLabel,
    granularityLabel,
    summarize,
    sparklinePoints,
  } from "$lib/config/history-ops";
  import {
    ensureHistory,
    readHistory,
    refreshHistory,
  } from "$lib/stores/history.svelte";

  let { control }: { control: Control } = $props();

  const spec = $derived(control.history);

  $effect(() => {
    if (control.stateId && spec) ensureHistory(control.stateId, spec);
  });

  const entry = $derived(
    control.stateId && spec ? readHistory(control.stateId, spec) : undefined,
  );
  const summary = $derived(entry ? summarize(entry.series) : undefined);
  const points = $derived(
    entry ? sparklinePoints(entry.series, 120, 24, 2) : "",
  );

  function refresh() {
    if (control.stateId && spec) refreshHistory(control.stateId, spec);
  }
</script>

{#if spec && control.stateId}
  <div class="history-summary">
    <span class="label-mono name">{control.label || control.feature}</span>
    <span class="config text-muted"
      >{durationLabel(spec)} · {granularityLabel(spec)}</span
    >
    <svg viewBox="0 0 120 24" class="spark" aria-hidden="true">
      <polyline {points} fill="none" />
    </svg>
    <span class="status text-muted">
      {#if !entry || entry.status === "loading"}
        …
      {:else if entry.status === "empty"}
        no data
      {:else if entry.status === "error"}
        <span class="err">{entry.error}</span>
      {:else if summary}
        {summary.count} pts · {summary.min}–{summary.max}{control.unit
          ? ` ${control.unit}`
          : ""}
      {/if}
    </span>
    <button
      type="button"
      class="icon-btn"
      title="Refresh history"
      aria-label="Refresh history"
      onclick={refresh}
    >
      <span class="material-symbols-outlined">refresh</span>
    </button>
  </div>
{/if}

<style>
  .history-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--body-sm);
    padding-left: 0.5rem;
  }

  .name {
    font-weight: 600;
  }

  .spark {
    width: 120px;
    height: 24px;
    display: block;
    flex: none;
  }

  .spark polyline {
    stroke: var(--primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .status {
    margin-left: auto;
  }

  .err {
    color: var(--danger-color, #c0392b);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn .material-symbols-outlined {
    font-size: 16px;
  }
</style>
