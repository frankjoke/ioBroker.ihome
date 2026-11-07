<script lang="ts">
  import {
    logicApplyDefaults,
    planLogicApply,
    resolveTemplateParams,
  } from "$lib/config/template-apply";
  import { stateIdFor } from "$lib/config/variables";
  import {
    commitLogics,
    getLogicDocument,
    isLogicsWritable,
    logicBlocked,
  } from "$lib/stores/logics.svelte";
  import { getVariables } from "$lib/stores/variables.svelte";
  import TemplateParamForm from "./TemplateParamForm.svelte";
  import type { LogicTemplate } from "$logic/types";

  let {
    template,
    onClose,
  }: {
    template: LogicTemplate;
    onClose: () => void;
  } = $props();

  const doc = $derived(getLogicDocument());
  const writable = $derived(isLogicsWritable());
  const blocked = $derived(logicBlocked());
  // svelte-ignore state_referenced_locally
  let values = $state(logicApplyDefaults(template.params));
  let error = $state("");

  function apply() {
    error = "";
    if (!writable) {
      error = "The logic document could not be loaded.";
      return;
    }
    if (blocked) {
      error = "The logic document has errors — fix them before applying.";
      return;
    }
    const resolved = resolveTemplateParams(template.params, values, (ref) =>
      stateIdFor(ref, getVariables()),
    );
    if ("problem" in resolved) {
      error = resolved.problem;
      return;
    }
    const plan = planLogicApply(
      template,
      resolved.values,
      doc.logics.map((logic) => logic.id),
      doc.logics,
    );
    if ("problem" in plan) {
      error = plan.problem;
      return;
    }
    if (!commitLogics({ ...doc, logics: [...doc.logics, plan.logic] })) {
      error = "The logic document could not be saved.";
      return;
    }
    onClose();
  }
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Apply logic template"
>
  <div class="modal-card card">
    <h3>Apply logic template</h3>
    <div class="body">
      <p class="hint text-muted">
        Insert <strong>{template.name}</strong> into the logic document. The applied
        copy is unlinked from the template.
      </p>
      {#if template.description}
        <p class="hint text-muted">{template.description}</p>
      {/if}
      <TemplateParamForm params={template.params} bind:values />
      {#if !writable}
        <p class="text-danger hint">
          The logic document could not be loaded — applying is disabled.
        </p>
      {:else if blocked}
        <p class="text-danger hint">
          The logic document has errors — fix them before applying.
        </p>
      {/if}
      {#if error}
        <p class="text-danger hint">{error}</p>
      {/if}
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!writable || blocked}
        onclick={apply}
      >
        Apply
      </button>
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
    width: min(36rem, 100%);
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

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
