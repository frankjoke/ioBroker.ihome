<script lang="ts">
  import { BUILTIN_TEMPLATES, instantiateTemplate } from "$logic/templates";
  import { validateLogicDocument } from "$logic/validate";
  import type { LogicDef } from "$logic/types";
  import StateRefField from "./StateRefField.svelte";

  let {
    taken,
    onInsert,
    onClose,
  }: {
    taken: string[];
    onInsert: (logic: LogicDef) => void;
    onClose: () => void;
  } = $props();

  let templateId = $state(BUILTIN_TEMPLATES[0].id);
  let values = $state<Record<string, string | number | boolean>>({});
  let error = $state("");

  const template = $derived(
    BUILTIN_TEMPLATES.find((entry) => entry.id === templateId) ??
      BUILTIN_TEMPLATES[0],
  );

  // A newly chosen template starts from its defaults.
  $effect(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const param of template.params) {
      if (param.default !== undefined) defaults[param.name] = param.default;
    }
    values = defaults;
    error = "";
  });

  function uniqueId(base: string): string {
    let id = base;
    let index = 2;
    while (taken.includes(id)) id = `${base}-${index++}`;
    return id;
  }

  function insert() {
    try {
      const logic = instantiateTemplate(
        template,
        values,
        uniqueId(template.id),
      );
      const problem = validateLogicDocument({
        version: 3,
        logics: [logic],
      }).find((issue) => issue.severity === "error");
      if (problem) {
        error = `${problem.path}: ${problem.message}`;
        return;
      }
      onInsert(logic);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Insert template">
  <div class="modal-card card">
    <h3>Insert template</h3>
    <div class="body">
      <label class="label-mono" for="template-select">Template</label>
      <select
        id="template-select"
        aria-label="Template"
        value={templateId}
        onchange={(e) => (templateId = e.currentTarget.value)}
      >
        {#each BUILTIN_TEMPLATES as entry (entry.id)}
          <option value={entry.id}>{entry.name}</option>
        {/each}
      </select>
      <p class="hint text-muted">{template.description}</p>

      {#each template.params as param (param.name)}
        <div class="param">
          <div class="row">
            <span class="label-mono param-label">{param.label}</span>
            {#if param.type === "state"}
              <StateRefField
                value={String(values[param.name] ?? "")}
                label={param.label}
                onchange={(ref) => (values = { ...values, [param.name]: ref })}
              />
            {:else if param.type === "number"}
              <input
                type="number"
                aria-label={param.label}
                value={String(values[param.name] ?? "")}
                onchange={(e) =>
                  (values = {
                    ...values,
                    [param.name]: Number(e.currentTarget.value),
                  })}
              />
            {:else if param.type === "boolean"}
              <input
                type="checkbox"
                aria-label={param.label}
                checked={values[param.name] === true}
                onchange={(e) =>
                  (values = {
                    ...values,
                    [param.name]: e.currentTarget.checked,
                  })}
              />
            {:else}
              <input
                aria-label={param.label}
                placeholder={param.type === "duration" ? "2m" : ""}
                value={String(values[param.name] ?? "")}
                onchange={(e) =>
                  (values = { ...values, [param.name]: e.currentTarget.value })}
              />
            {/if}
          </div>
          {#if param.description}
            <span class="param-help text-muted">{param.description}</span>
          {/if}
        </div>
      {/each}

      {#if error}
        <p class="text-danger hint">{error}</p>
      {/if}
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={insert}
        >Insert</button
      >
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
    z-index: 50;
  }

  .modal-card {
    width: min(36rem, 92vw);
    max-height: 88vh;
    overflow: auto;
    padding: 1rem;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0.8rem 0;
  }

  .param {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .param-label {
    min-width: 8rem;
  }

  .param-help {
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
