<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { applyRead } from "$lib/utils/transform";
  import {
    sanitizeLabel,
    computeVirtual,
    type LocalControl,
  } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue } from "$lib/config/format";

  let {
    control,
    siblings,
    onChange,
  }: {
    control: Control;
    siblings: Control[];
    onChange: (c: Control) => void;
  } = $props();

  function setExpr(expr: string) {
    onChange({ ...control, virtual: { ...control.virtual, expr } });
  }
  function setPrecision(v: string) {
    onChange({
      ...control,
      virtual: {
        ...control.virtual,
        expr: control.virtual?.expr ?? "",
        precision: v === "" ? undefined : Number(v),
      },
    });
  }

  function liveOf(c: Control): unknown {
    if (c.kind === "virtual" || !c.stateId) return undefined;
    const st: any = ioBroker.states.get(c.stateId);
    return st ? applyRead(st.val, c.transform) : undefined;
  }

  // Local variable legend (state controls only), mirroring buildScope's naming.
  const legend = $derived.by(() => {
    const taken = new Set<string>();
    return siblings
      .filter((c) => c.kind !== "virtual")
      .map((c) => ({
        name: sanitizeLabel(c.label || c.feature, taken),
        value: liveOf(c),
      }));
  });

  const locals = $derived<LocalControl[]>(
    siblings.map((c) => ({
      kind: c.kind,
      label: c.label,
      feature: c.feature,
      liveValue: liveOf(c),
    })),
  );

  const preview = $derived(
    computeVirtual({ virtual: control.virtual }, locals, getVirtualPool()),
  );
</script>

<div class="virtual-editor">
  <label class="field">
    <span class="label-mono">Expression</span>
    <textarea
      rows="3"
      spellcheck="false"
      class="mono"
      value={control.virtual?.expr ?? ""}
      oninput={(e) => setExpr(e.currentTarget.value)}
    ></textarea>
  </label>

  <div class="cols">
    <div class="vars">
      <span class="label-mono">Variables</span>
      {#each legend as l (l.name)}
        <button
          type="button"
          class="var"
          title="Insert"
          onclick={() => setExpr((control.virtual?.expr ?? "") + l.name)}
        >
          <code>{l.name}</code> = {formatValue(l.value)}
        </button>
      {/each}
    </div>
    <div class="ref">
      <span class="label-mono">Helpers</span>
      <code>values(f)</code><code>count(f, pred?)</code><code
        >sum/avg/min/max(f)</code
      >
      <code>any/all(f, pred?)</code><code>get(stateId)</code><code
        >get(device + label)</code
      ><code>device(name).label</code>
      <span class="label-mono">filter: role·room·device·feature·label</span>
    </div>
  </div>

  <div class="row">
    <label class="field small"
      ><span class="label-mono">Precision</span>
      <input
        type="number"
        min="0"
        max="10"
        value={control.virtual?.precision ?? ""}
        oninput={(e) => setPrecision(e.currentTarget.value)}
      /></label
    >
    <div class="preview">
      <span class="label-mono">Result</span>
      {#if preview.error}
        <span class="err">{preview.error}</span>
      {:else}
        <span class="mono">{formatValue(preview.value, control.unit)}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .virtual-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-low, #fafafa);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.small {
    max-width: 8rem;
  }
  textarea.mono {
    font-family: var(--font-mono);
    resize: vertical;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .vars,
  .ref {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .var {
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    padding: 0;
    font-size: var(--body-sm);
  }
  .var:hover {
    color: var(--primary);
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .err {
    color: var(--danger-color, #c0392b);
    font-size: var(--body-sm);
  }
</style>
