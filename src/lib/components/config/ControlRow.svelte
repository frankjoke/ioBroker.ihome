<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { getPickerValue } from "$lib/picker-values.svelte.js";
  import { formatAge, formatValue, splitReading } from "$lib/config/format";
  import { time } from "$lib/time.svelte.js";
  import { effectiveCommon } from "$lib/config/state-meta";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { applyRead } from "$lib/utils/transform";
  import { computeVirtual, type LocalControl } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { stateIdFor, variableScope } from "$lib/config/variables";
  import { historyEnabled } from "$lib/config/history-ops";
  import TransformEditor from "./TransformEditor.svelte";
  import ControlMetaEditor from "./ControlMetaEditor.svelte";
  import VirtualEditor from "./VirtualEditor.svelte";
  import HistoryEditor from "./HistoryEditor.svelte";
  import HistorySummary from "./HistorySummary.svelte";

  let {
    control,
    siblings = [],
    autoOpen = false,
    open = false,
    onToggle,
    onChange,
    onChangeState,
    onRemove,
  }: {
    control: Control;
    siblings?: Control[];
    autoOpen?: boolean;
    /** Whether this row's editor is open; the parent owns the one-open rule. */
    open?: boolean;
    onToggle: () => void;
    onChange: (c: Control) => void;
    onChangeState: () => void;
    onRemove: () => void;
  } = $props();

  let showTransform = $state(false);
  let showFormula = $state(false);
  let showHistory = $state(false);

  /** The metadata keys a control may override on top of the broker object. */
  const OVERRIDE_KEYS = [
    "role",
    "type",
    "states",
    "hideUnit",
    "min",
    "max",
    "step",
    "read",
    "write",
    "room",
    "functions",
    "common",
  ] as const;

  const hasOverrides = $derived(
    OVERRIDE_KEYS.some(
      (key) =>
        (control as unknown as Record<string, unknown>)[key] !== undefined,
    ),
  );

  /** Clears this control's overrides only — the broker object stays as it is. */
  function resetOverrides() {
    const next = { ...control } as unknown as Record<string, unknown>;
    for (const key of OVERRIDE_KEYS) delete next[key];
    onChange(next as unknown as Control);
  }

  /** The line toggles the row; its actions and fields never do. */
  function onLineClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    onToggle();
  }

  const isVirtual = $derived(control.kind === "virtual");
  const canHistory = $derived(
    !!control.stateId &&
      historyEnabled(
        ioBroker.objects.get(stateIdFor(control.stateId, getVariables())),
      ),
  );

  $effect(() => {
    if (autoOpen) {
      showFormula = true;
    }
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
    const parts = splitReading(
      l.val,
      meta.unit,
      undefined,
      meta.states,
      meta.role,
      time.now,
    );
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
  /** The control's own name, shown before the value only when it says more than
   *  the state id already does (the raw states almost always do). Compared
   *  exactly: `TEMPERATURE` vs `Temperature` is a different label. */
  const rowLabel = $derived(control.label?.trim() ?? "");
  const labelDiffers = $derived(
    !!rowLabel && rowLabel !== stateParts.tail.trim(),
  );
</script>

{#snippet resetButton()}
  <!-- The title sits on the wrapper: a disabled button does not fire hover, so
       its own tooltip would never appear exactly when it is worth reading. -->
  <span
    class="tip"
    title="Reset this control's metadata overrides (this control only — the broker object is untouched)"
  >
    <button
      type="button"
      class="icon-btn"
      aria-label="Reset metadata overrides"
      disabled={!hasOverrides}
      onclick={resetOverrides}
    >
      <span class="material-symbols-outlined">undo</span>
    </button>
  </span>
{/snippet}

<div class="item" class:open>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="item-line" onclick={onLineClick}>
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
      {#if open}
        <button
          type="button"
          class="icon-btn"
          title="Edit formula"
          aria-label="Edit formula"
          onclick={() => {
            showFormula = true;
          }}
        >
          <span class="material-symbols-outlined">edit</span>
        </button>
      {/if}{@render resetButton()}
    {:else}
      <div class="state">
        <span class="state-id mono" title={control.stateId ?? ""}
          ><span class="sid-head">{stateParts.head}</span><span class="sid-tail"
            >{stateParts.tail}</span
          ></span
        >
        <span class="state-val"
          >{#if labelDiffers}<strong class="state-label">{rowLabel}:</strong
            >{/if}{valueLabel}</span
        >
      </div>

      {#if open}
        <button
          type="button"
          class="icon-btn"
          title="Change state"
          aria-label="Change state"
          onclick={onChangeState}
        >
          <span class="material-symbols-outlined">edit</span>
        </button>
      {/if}{@render resetButton()}

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
          onclick={() => {
            if (!open) onToggle();
            showHistory = true;
          }}
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
        onclick={() => {
          if (!open) onToggle();
          showTransform = !showTransform;
        }}
      >
        <span class="material-symbols-outlined">functions</span>
      </button>
    {/if}

    <span class="item-actions">
      <button
        type="button"
        class="icon-btn"
        title="Remove"
        aria-label="Remove control"
        onclick={onRemove}
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    </span>
  </div>

  {#if open}
    <div class="item-editor">
      <div class="line">
        <label class="field"
          ><span class="label-mono">Label</span>
          <input
            type="text"
            value={control.label ?? ""}
            oninput={(e) =>
              onChange({ ...control, label: e.currentTarget.value })}
          /></label
        >
        <label class="field"
          ><span class="label-mono">Unit</span>
          <input
            type="text"
            value={control.unit ?? ""}
            title="Display unit. A date/time state also accepts ago, time, date, datetime or a pattern like HH:mm:ss."
            oninput={(e) =>
              onChange({ ...control, unit: e.currentTarget.value })}
          /></label
        >
      </div>

      {#if !isVirtual}
        <ControlMetaEditor {control} onChange={(c) => onChange(c)} />
      {/if}

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
  {/if}
</div>

<style>
  .tip {
    display: inline-flex;
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

  /* The control's name when the state id does not already say it. */
  .state-label {
    color: var(--text-color);
    font-weight: 700;
    margin-right: 0.3em;
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

  .err {
    color: var(--danger-color, #c0392b);
  }
</style>
