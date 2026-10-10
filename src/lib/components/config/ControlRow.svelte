<script lang="ts">
  import type { Control, DeviceType } from "$lib/types/device";
  import { DEVICE_FEATURES } from "$lib/config/features";
  import { getPickerValue } from "$lib/picker-values.svelte.js";
  import { formatAge, formatValue } from "$lib/config/format";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import TransformEditor from "./TransformEditor.svelte";
  import VirtualEditor from "./VirtualEditor.svelte";

  let {
    control,
    deviceType,
    siblings = [],
    onChange,
    onRemove,
  }: {
    control: Control;
    deviceType: DeviceType;
    siblings?: Control[];
    onChange: (c: Control) => void;
    onRemove: () => void;
  } = $props();

  let showTransform = $state(false);

  const isVirtual = $derived(control.kind === "virtual");

  function setKind(kind: string) {
    if (kind === "virtual") {
      onChange({
        ...control,
        kind: "virtual",
        writable: false,
        stateId: undefined,
        transform: undefined,
        virtual: control.virtual ?? { expr: "" },
      });
    } else {
      onChange({ ...control, kind: undefined, virtual: undefined });
    }
  }

  const features = $derived(DEVICE_FEATURES[deviceType] ?? []);
  const featureOptions = $derived(
    features.some((f) => f.feature === control.feature)
      ? features
      : [
          {
            feature: control.feature,
            label: control.feature,
            widget: "value" as const,
            roleHints: [],
          },
          ...features,
        ],
  );

  function live() {
    if (!control.stateId) return undefined;
    const st: any = ioBroker.states.get(control.stateId);
    if (st) return { val: st.val, ts: st.ts };
    return getPickerValue(control.stateId);
  }

  const valueLabel = $derived.by(() => {
    const l = live();
    if (!l) return "…";
    return `${formatValue(l.val, control.unit)} · ${formatAge(l.ts)}`;
  });
</script>

<div class="control-row">
  <div class="line">
    <select
      class="kind"
      value={control.kind ?? "state"}
      onchange={(e) => setKind(e.currentTarget.value)}
      aria-label="Control kind"
    >
      <option value="state">State</option>
      <option value="virtual">Virtual</option>
    </select>

    {#if !isVirtual}
      <select
        class="feature"
        value={control.feature}
        onchange={(e) =>
          onChange({ ...control, feature: e.currentTarget.value })}
      >
        {#each featureOptions as f (f.feature)}
          <option value={f.feature}>{f.label}</option>
        {/each}
      </select>

      <div class="state">
        <span class="state-id mono">{control.stateId}</span>
        <span class="state-val">{valueLabel}</span>
      </div>

      <label class="check"
        ><input
          type="checkbox"
          checked={control.writable}
          onchange={(e) =>
            onChange({ ...control, writable: e.currentTarget.checked })}
        /> writable</label
      >

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

  {#if isVirtual}
    <VirtualEditor {control} {siblings} onChange={(c) => onChange(c)} />
  {:else if showTransform}
    <TransformEditor
      transform={control.transform}
      sampleValue={live()?.val}
      onChange={(t) => onChange({ ...control, transform: t })}
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

  .state-id {
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    color: var(--primary);
  }
</style>
