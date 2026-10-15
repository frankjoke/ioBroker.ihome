<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { newId } from "$lib/utils/ids";
  import { untrack } from "svelte";
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
    addFormula,
    upsertFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import { applyTemplate, detachTemplate } from "$lib/config/formulas";
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

  // Local draft — the modal edits here and commits on Save.
  const init = untrack(() => ({
    expr: control.virtual?.expr ?? "",
    precision: control.virtual?.precision,
    unit: control.unit ?? "",
    formulaId: control.formulaId as string | undefined,
  }));
  let expr = $state(init.expr);
  let precision = $state<number | undefined>(init.precision);
  let unit = $state(init.unit);
  let formulaId = $state<string | undefined>(init.formulaId);
  let newTemplateName = $state("");

  const templates = $derived(getFormulas());
  const sourceTemplate = $derived(
    formulaId ? templates.find((t) => t.id === formulaId) : undefined,
  );
  const changed = $derived(!!sourceTemplate && sourceTemplate.expr !== expr);
  const hasName = $derived(newTemplateName.trim() !== "");
  const actionLabel = $derived(
    hasName
      ? "Save as new template"
      : changed
        ? "Update template"
        : "Save as template",
  );
  const actionEnabled = $derived(hasName || changed);

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
    computeVirtual({ virtual: { expr, precision } }, locals, getVirtualPool()),
  );

  function pickTemplate(id: string) {
    if (id === "") {
      formulaId = undefined;
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (t) {
      expr = t.expr;
      precision = t.precision;
      if (t.unit !== undefined) unit = t.unit;
      formulaId = t.id;
    }
  }

  function runTemplateAction() {
    if (hasName) {
      const id = newId();
      addFormula({ id, name: newTemplateName.trim(), expr, precision, unit });
      saveFormulas();
      formulaId = id;
      newTemplateName = "";
    } else if (changed && sourceTemplate) {
      upsertFormula({ ...sourceTemplate, expr, precision, unit });
      saveFormulas();
    }
  }

  function save() {
    const keep =
      sourceTemplate && sourceTemplate.expr === expr ? formulaId : undefined;
    let next: Control = {
      ...control,
      unit: unit || undefined,
      formulaId: keep,
      virtual: { expr, precision },
    };
    if (!keep) next = detachTemplate(next);
    onChange(next);
    onClose();
  }
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
        <span class="label-mono">Template</span>
        <select
          value={formulaId ?? ""}
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
      <button
        type="button"
        class="btn"
        disabled={!actionEnabled}
        onclick={runTemplateAction}
      >
        {actionLabel}
      </button>
    </div>

    <div class="virtual-editor">
      <label class="field">
        <span class="label-mono">Expression</span>
        <textarea rows="3" spellcheck="false" class="mono" bind:value={expr}
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
              onclick={() => (expr += l.name)}
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
            value={precision ?? ""}
            oninput={(e) =>
              (precision =
                e.currentTarget.value === ""
                  ? undefined
                  : Number(e.currentTarget.value))}
          /></label
        >
        <label class="field small"
          ><span class="label-mono">Unit</span>
          <input type="text" bind:value={unit} /></label
        >
        <div class="preview">
          <span class="label-mono">Result</span>
          {#if preview.error}
            <span class="err">{preview.error}</span>
          {:else}
            <span class="mono">{formatValue(preview.value, unit)}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="actions">
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
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
