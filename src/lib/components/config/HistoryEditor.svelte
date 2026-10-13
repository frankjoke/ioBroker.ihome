<script lang="ts">
  import type {
    Control,
    HistoryAggregate,
    HistoryDurationUnit,
    HistorySpec,
  } from "$lib/types/device";
  import { untrack } from "svelte";
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
    noteLive,
  } from "$lib/stores/history.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { debounce } from "$lib/utils/debounce";

  let {
    control,
    onChange,
    onClose,
  }: {
    control: Control;
    onChange: (c: Control) => void;
    onClose: () => void;
  } = $props();

  let draft = $state<HistorySpec>(
    JSON.parse(
      JSON.stringify(
        untrack(
          () =>
            control.history ?? {
              duration: 24,
              durationUnit: "hours",
              count: 200,
            },
        ),
      ),
    ),
  );

  const AGGREGATES: HistoryAggregate[] = [
    "average",
    "min",
    "max",
    "total",
    "count",
    "none",
    "onchange",
  ];
  const STEP_UNITS: ("seconds" | "minutes" | "hours")[] = [
    "seconds",
    "minutes",
    "hours",
  ];

  function num(v: string): number | undefined {
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  // The draft spec, so effects track the fields rather than the draft object.
  const draftSpec = $derived<HistorySpec>({
    duration: draft.duration,
    durationUnit: draft.durationUnit,
    count: draft.count,
    step: draft.step,
    stepUnit: draft.stepUnit,
    aggregate: draft.aggregate,
  });

  // Debounce the preview fetch so typing a duration doesn't fire one
  // getHistory per keystroke.
  const schedulePreview = debounce(
    (stateId: string, s: HistorySpec) => ensureHistory(stateId, s),
    250,
  );

  $effect(() => {
    if (control.stateId) schedulePreview(control.stateId, draftSpec);
  });

  $effect(() => {
    if (!control.stateId) return;
    const st: any = ioBroker.states?.get(control.stateId);
    if (st && typeof st.ts === "number" && Number.isFinite(st.val)) {
      noteLive(control.stateId, draftSpec, { ts: st.ts, val: st.val });
    }
  });

  const entry = $derived(
    control.stateId ? readHistory(control.stateId, draftSpec) : undefined,
  );
  const summary = $derived(entry ? summarize(entry.series) : undefined);
  const points = $derived(
    entry ? sparklinePoints(entry.series, 240, 48, 4) : "",
  );

  function refresh() {
    if (control.stateId) refreshHistory(control.stateId, draftSpec);
  }
  function save() {
    onChange({ ...control, history: draft });
    onClose();
  }
  function remove() {
    onChange({ ...control, history: undefined });
    onClose();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onClose();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label="History">
  <div class="modal-card card">
    <h3>History — {control.label || control.feature}</h3>

    <div class="grid">
      <label class="field"
        ><span class="label-mono">Duration</span>
        <input
          type="number"
          min="1"
          value={draft.duration}
          oninput={(e) => (draft.duration = Number(e.currentTarget.value) || 1)}
        /></label
      >
      <label class="field"
        ><span class="label-mono">Unit</span>
        <select
          value={draft.durationUnit}
          onchange={(e) =>
            (draft.durationUnit = e.currentTarget.value as HistoryDurationUnit)}
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select></label
      >
    </div>

    <div class="grid">
      <label class="field"
        ><span class="label-mono">Samples</span>
        <input
          type="number"
          min="1"
          value={draft.count ?? ""}
          oninput={(e) => (draft.count = num(e.currentTarget.value))}
        /></label
      >
      <span class="hint text-muted">count wins when set</span>
    </div>

    <div class="grid three">
      <label class="field"
        ><span class="label-mono">Interval</span>
        <input
          type="number"
          value={draft.step ?? ""}
          oninput={(e) => (draft.step = num(e.currentTarget.value))}
        /></label
      >
      <label class="field"
        ><span class="label-mono">Step unit</span>
        <select
          value={draft.stepUnit ?? "minutes"}
          onchange={(e) =>
            (draft.stepUnit = e.currentTarget.value as
              "seconds" | "minutes" | "hours")}
        >
          {#each STEP_UNITS as u (u)}
            <option value={u}>{u}</option>
          {/each}
        </select></label
      >
      <label class="field"
        ><span class="label-mono">Aggregate</span>
        <select
          value={draft.aggregate ?? "average"}
          onchange={(e) =>
            (draft.aggregate = e.currentTarget.value as HistoryAggregate)}
        >
          {#each AGGREGATES as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select></label
      >
    </div>

    <div class="preview">
      <span class="label-mono"
        >{durationLabel(draft)} · {granularityLabel(draft)}</span
      >
      <svg viewBox="0 0 240 48" class="spark" aria-hidden="true">
        <polyline {points} fill="none" />
      </svg>
      <div class="status text-muted">
        {#if !entry}
          …
        {:else if entry.status === "loading"}
          loading…
        {:else if entry.status === "empty"}
          no data in range
        {:else if entry.status === "error"}
          <span class="err">{entry.error}</span>
        {:else if summary}
          {summary.count} points · {summary.min}–{summary.max}{control.unit
            ? ` ${control.unit}`
            : ""}
        {/if}
      </div>
    </div>

    <div class="actions">
      {#if control.history}
        <button type="button" class="btn" onclick={remove}>Remove</button>
      {/if}
      <button type="button" class="btn" onclick={refresh}>Refresh</button>
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={save}>Save</button>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(520px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    align-items: end;
  }

  .grid.three {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint {
    font-size: var(--body-sm);
    padding-bottom: 0.35rem;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-low, #fafafa);
  }

  .spark {
    width: 100%;
    height: 48px;
    display: block;
  }

  .spark polyline {
    stroke: var(--primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .status {
    font-size: var(--body-sm);
  }

  .err {
    color: var(--danger-color, #c0392b);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
