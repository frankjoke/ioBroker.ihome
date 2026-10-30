<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { getPickerValue } from "$lib/picker-values.svelte.js";
  import { formatAge, formatValue, splitReading } from "$lib/config/format";
  import { effectiveCommon } from "$lib/config/state-meta";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { applyRead } from "$lib/utils/transform";
  import { computeVirtual, type LocalControl } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { stateIdFor, variableScope } from "$lib/config/variables";
  import { historyEnabled } from "$lib/config/history-ops";
  import TransformEditor from "./TransformEditor.svelte";
  import VirtualEditor from "./VirtualEditor.svelte";
  import HistoryEditor from "./HistoryEditor.svelte";
  import HistorySummary from "./HistorySummary.svelte";

  let {
    control,
    siblings = [],
    autoOpen = false,
    onChange,
    onChangeState,
    onRemove,
  }: {
    control: Control;
    siblings?: Control[];
    autoOpen?: boolean;
    onChange: (c: Control) => void;
    onChangeState: () => void;
    onRemove: () => void;
  } = $props();

  let showTransform = $state(false);
  let showFormula = $state(false);
  let showHistory = $state(false);

  const isVirtual = $derived(control.kind === "virtual");
  const canHistory = $derived(
    !!control.stateId &&
      historyEnabled(
        ioBroker.objects.get(stateIdFor(control.stateId, getVariables())),
      ),
  );

  $effect(() => {
    if (autoOpen) showFormula = true;
  });

  function live() {
    if (!control.stateId) return undefined;
    const id = stateIdFor(control.stateId, getVariables());
    const st: any = ioBroker.states.get(id);
    if (st) return { val: st.val, ts: st.ts };
    return getPickerValue(id);
  }

  const valueLabel = $derived.by(() => {
    const l = live();
    if (!l) return "…";
    const id = stateIdFor(control.stateId ?? "", getVariables());
    const meta = effectiveCommon(control, ioBroker.objects.get(id));
    const parts = splitReading(l.val, meta.unit, undefined, meta.states);
    const reading = parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
    return `${reading} · ${formatAge(l.ts)}`;
  });

  function liveOf(c: Control): unknown {
    if (c.kind === "virtual" || !c.stateId) return undefined;
    const st: any = ioBroker.states.get(stateIdFor(c.stateId, getVariables()));
    return st ? applyRead(st.val, c.transform) : undefined;
  }

  /** Variables as scope extras: constants by value, state variables live. */
  const variableExtras = $derived(
    variableScope(
      getVariables(),
      (id) => (ioBroker.states as Map<string, any>)?.get?.(id)?.val,
    ),
  );

  const virtualValue = $derived.by(() => {
    if (!isVirtual) return undefined;
    const locals: LocalControl[] = siblings.map((c) => ({
      kind: c.kind,
      label: c.label,
      feature: c.feature,
      liveValue: liveOf(c),
    }));
    return computeVirtual(
      { virtual: control.virtual },
      locals,
      getVirtualPool(),
      variableExtras,
    );
  });

  function shortFormula(expr: string | undefined): string {
    if (!expr) return "(empty formula)";
    return expr.length > 60 ? expr.slice(0, 60) + "…" : expr;
  }

  // Long ids lose their middle, not their end: the adapter stays visible at the
  // start and the state at the end (bambulab.0.0309…BedTemp).
  const stateParts = $derived.by(() => {
    const id = control.stateId ?? "";
    const cut = id.lastIndexOf(".");
    return cut > 0
      ? { head: id.slice(0, cut + 1), tail: id.slice(cut + 1) }
      : { head: id, tail: "" };
  });
</script>

<div class="control-row">
  <div class="line">
    <span class="kind-badge">{isVirtual ? "Formula" : "State"}</span>

    {#if isVirtual}
      <div class="state">
        <span class="state-id mono" title={control.virtual?.expr ?? ""}
          >{shortFormula(control.virtual?.expr)}</span
        >
        <span class="state-val">
          {#if virtualValue?.error}
            <span class="err" title={virtualValue.error}>error</span>
          {:else}
            {formatValue(virtualValue?.value, control.unit)}
          {/if}
        </span>
      </div>
      <button
        type="button"
        class="icon-btn"
        title="Edit formula"
        aria-label="Edit formula"
        onclick={() => (showFormula = true)}
      >
        <span class="material-symbols-outlined">edit</span>
      </button>
    {:else}
      <div class="state">
        <span class="state-id mono" title={control.stateId ?? ""}
          ><span class="sid-head">{stateParts.head}</span><span class="sid-tail"
            >{stateParts.tail}</span
          ></span
        >
        <span class="state-val">{valueLabel}</span>
      </div>

      <button
        type="button"
        class="icon-btn"
        title="Change state"
        aria-label="Change state"
        onclick={onChangeState}
      >
        <span class="material-symbols-outlined">edit</span>
      </button>

      <label class="check"
        ><input
          type="checkbox"
          checked={control.writable}
          onchange={(e) =>
            onChange({ ...control, writable: e.currentTarget.checked })}
        /> writable</label
      >

      {#if canHistory}
        <button
          type="button"
          class="icon-btn"
          class:active={!!control.history}
          title="History"
          aria-label="History"
          onclick={() => (showHistory = true)}
        >
          <span class="material-symbols-outlined">history</span>
        </button>
      {/if}

      <button
        type="button"
        class="icon-btn"
        class:active={showTransform}
        title="Transform"
        aria-label="Toggle transform"
        onclick={() => (showTransform = !showTransform)}
      >
        <span class="material-symbols-outlined">functions</span>
      </button>
    {/if}

    <button
      type="button"
      class="icon-btn"
      title="Remove"
      aria-label="Remove control"
      onclick={onRemove}
    >
      <span class="material-symbols-outlined">delete</span>
    </button>
  </div>

  <div class="line">
    <label class="field"
      ><span class="label-mono">Label</span>
      <input
        type="text"
        value={control.label ?? ""}
        oninput={(e) => onChange({ ...control, label: e.currentTarget.value })}
      /></label
    >
    <label class="field"
      ><span class="label-mono">Unit</span>
      <input
        type="text"
        value={control.unit ?? ""}
        oninput={(e) => onChange({ ...control, unit: e.currentTarget.value })}
      /></label
    >
  </div>

  {#if !isVirtual && control.history && control.stateId}
    <HistorySummary {control} />
  {/if}

  {#if isVirtual}
    {#if showFormula}
      <VirtualEditor
        {control}
        {siblings}
        onClose={() => (showFormula = false)}
        onChange={(c) => onChange(c)}
      />
    {/if}
  {:else if showTransform}
    <TransformEditor
      transform={control.transform}
      sampleValue={live()?.val}
      onChange={(t) => onChange({ ...control, transform: t })}
    />
  {/if}

  {#if showHistory}
    <HistoryEditor
      {control}
      onChange={(c) => onChange(c)}
      onClose={() => (showHistory = false)}
    />
  {/if}
</div>

<style>
  .control-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .state {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 8rem;
  }

  .kind-badge {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    padding: 2px 7px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    white-space: nowrap;
  }

  .state-id {
    display: flex;
    font-size: 0.75rem;
    max-width: 40ch;
    overflow: hidden;
    white-space: nowrap;
  }

  .sid-head {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sid-tail {
    flex: 0 0 auto;
  }

  .state-val {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: var(--body-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 6rem;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn.active {
    color: var(--primary-color);
  }

  .err {
    color: var(--danger-color, #c0392b);
  }
</style>
