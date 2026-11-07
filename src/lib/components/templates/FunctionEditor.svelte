<script lang="ts">
  import CodeField from "$lib/components/logic/CodeField.svelte";
  import { functionTemplateProblem } from "$lib/config/functions";
  import {
    functionSaveFailed,
    isFunctionsWritable,
  } from "$lib/stores/functions.svelte";
  import type { FunctionTemplate } from "$lib/types/device";

  let {
    template,
    isNew = false,
    dirty = $bindable(false),
    onSave,
  }: {
    template: FunctionTemplate;
    isNew?: boolean;
    dirty?: boolean;
    onSave: (template: FunctionTemplate) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<FunctionTemplate>({ ...template });

  $effect(() => {
    if (draft.id !== template.id) draft = { ...template };
  });

  const writable = $derived(isFunctionsWritable());
  const saveFailed = $derived(functionSaveFailed());
  const problem = $derived(functionTemplateProblem(draft));
  const isDirty = $derived(
    isNew || JSON.stringify(draft) !== JSON.stringify(template),
  );
  $effect(() => {
    dirty = isDirty;
  });

  function save() {
    if (problem || !isDirty || !writable) return;
    onSave({ ...draft, name: draft.name.trim() || "Untitled" });
  }
</script>

<div class="editor-form">
  <label class="field"
    ><span class="label-mono">Name</span>
    <input type="text" bind:value={draft.name} /></label
  >
  <label class="field"
    ><span class="label-mono">Mode</span>
    <select bind:value={draft.mode}>
      <option value="expression">Expression</option>
      <option value="statements">Statements</option>
    </select></label
  >
  <label class="field"
    ><span class="label-mono">Description</span>
    <input type="text" bind:value={draft.description} /></label
  >
  <label class="field"
    ><span class="label-mono">Code</span>
    <CodeField
      code={draft.code}
      onchange={(code) => (draft.code = code)}
      label="Snippet code"
      mode={draft.mode}
    /></label
  >
  {#if !writable}
    <p class="text-danger hint">
      Function templates could not be loaded — saving is disabled.
    </p>
  {:else if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
  {#if problem}
    <p class="text-danger hint">{problem}</p>
  {/if}
  <div class="actions">
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={!!problem || !isDirty || !writable}
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

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
