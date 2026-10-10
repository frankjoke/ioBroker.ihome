<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { applyRead } from "$lib/utils/transform";
  import {
    sanitizeLabel,
    computeVirtual,
    newLocalTaken,
    type LocalControl,
  } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import {
    getFormulas,
    getFormula,
    addFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import { applyTemplate, syncFormulaId } from "$lib/config/formulas";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue } from "$lib/config/format";

  let {
    control,
    siblings,
    onClose,
    onChange,
  }: {
    control: Control;
    siblings: Control[];
    onClose: () => void;
    onChange: (c: Control) => void;
  } = $props();

  const templates = $derived(getFormulas());
  const sourceName = $derived(
    control.formulaId
      ? (getFormula(control.formulaId)?.name ?? "custom")
      : "custom",
  );
  let newTemplateName = $state("");

  function setExpr(expr: string) {
    const next = { ...control, virtual: { ...control.virtual, expr } };
    onChange(
      syncFormulaId(next, { version: 0, updatedAt: 0, formulas: templates }),
    );
  }
  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) onChange(applyTemplate(control, t));
  }
  function saveAsTemplate() {
    const name = newTemplateName.trim() || control.label || "New template";
    const id = crypto.randomUUID();
    addFormula({
      id,
      name,
      expr: control.virtual?.expr ?? "",
      precision: control.virtual?.precision,
      unit: control.unit,
    });
    saveFormulas();
    onChange({ ...control, formulaId: id });
    newTemplateName = "";
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
    const taken = newLocalTaken();
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

<div class="modal" role="dialog" aria-modal="true" aria-label="Virtual state">
  <div class="modal-content">
    <div class="modal-head">
      <h3>Virtual state</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="template-bar">
      <label class="field">
        <span class="label-mono">Template ({sourceName})</span>
        <select
          value={control.formulaId ?? ""}
          onchange={(e) => pickTemplate(e.currentTarget.value)}
        >
          <option value="">— custom —</option>
          {#each templates as t (t.id)}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
      </label>
      <input
        type="text"
        placeholder="new template name"
        bind:value={newTemplateName}
      />
      <button type="button" class="btn" onclick={saveAsTemplate}
        >Save as template</button
      >
    </div>

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
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(640px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal-head h3 {
    margin: 0;
  }
  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .template-bar {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .template-bar .field {
    flex: 1;
  }
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
