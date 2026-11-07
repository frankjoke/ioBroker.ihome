<script lang="ts">
  import CodeField from "$lib/components/logic/CodeField.svelte";
  import { formulaTemplateProblem } from "$lib/config/formulas";
  import {
    formulaSaveFailed,
    isFormulasWritable,
  } from "$lib/stores/formulas.svelte";
  import type { FormulaTemplate } from "$lib/types/device";

  let {
    template,
    isNew = false,
    dirty = $bindable(false),
    problem = $bindable<string | null>(null),
    onSave,
  }: {
    template: FormulaTemplate;
    isNew?: boolean;
    dirty?: boolean;
    problem?: string | null;
    onSave: (template: FormulaTemplate) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<FormulaTemplate>({ ...template });

  $effect(() => {
    if (draft.id !== template.id) draft = { ...template };
  });

  const writable = $derived(isFormulasWritable());
  const saveFailed = $derived(formulaSaveFailed());
  const validation = $derived(formulaTemplateProblem(draft));
  const isDirty = $derived(
    isNew || JSON.stringify(draft) !== JSON.stringify(template),
  );
  $effect(() => {
    dirty = isDirty;
  });
  $effect(() => {
    problem = validation;
  });

  export function save() {
    if (validation || !isDirty || !writable) return;
    onSave({ ...draft, name: draft.name.trim() || "Untitled" });
  }
</script>

<div class="editor-form">
  <label class="field"
    ><span class="label-mono">Name</span>
    <input type="text" bind:value={draft.name} /></label
  >
  <label class="field"
    ><span class="label-mono">Expression</span>
    <CodeField
      code={draft.expr}
      onchange={(code) => (draft.expr = code)}
      label="Formula expression"
      mode="expression"
    /></label
  >
  <div class="form-grid">
    <label class="field"
      ><span class="label-mono">Unit</span>
      <input type="text" bind:value={draft.unit} /></label
    >
    <label class="field"
      ><span class="label-mono">Precision</span>
      <input
        type="number"
        min="0"
        max="10"
        value={draft.precision ?? ""}
        oninput={(e) =>
          (draft.precision =
            e.currentTarget.value === ""
              ? undefined
              : Number(e.currentTarget.value))}
      /></label
    >
  </div>
  <label class="field"
    ><span class="label-mono">Notes</span>
    <input type="text" bind:value={draft.notes} /></label
  >
  {#if !writable}
    <p class="text-danger hint">
      Formula templates could not be loaded — saving is disabled.
    </p>
  {:else if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
  {#if validation}
    <p class="text-danger hint">{validation}</p>
  {/if}
</div>

<style>
  .editor-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
