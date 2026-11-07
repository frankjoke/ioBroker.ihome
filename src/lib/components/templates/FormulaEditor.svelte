<script lang="ts">
  import { checkExpression } from "$logic/expr-code";
  import CodeField from "$lib/components/logic/CodeField.svelte";
  import type { FormulaTemplate } from "$lib/types/device";

  let {
    template,
    isNew = false,
    dirty = $bindable(false),
    onSave,
  }: {
    template: FormulaTemplate;
    isNew?: boolean;
    dirty?: boolean;
    onSave: (template: FormulaTemplate) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<FormulaTemplate>({ ...template });

  $effect(() => {
    if (draft.id !== template.id) draft = { ...template };
  });

  const problem = $derived(problemFor(draft));
  const isDirty = $derived(
    isNew || JSON.stringify(draft) !== JSON.stringify(template),
  );
  $effect(() => {
    dirty = isDirty;
  });

  function problemFor(value: FormulaTemplate): string | null {
    if (!value.name.trim()) return "A name is required.";
    if (!value.expr.trim()) return "The expression is empty.";
    return checkExpression(value.expr);
  }

  function save() {
    if (problem || !isDirty) return;
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
  {#if problem}
    <p class="text-danger hint">{problem}</p>
  {/if}
  <div class="actions">
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={!!problem || !isDirty}
      onclick={save}>Save</button
    >
  </div>
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

  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
