<script lang="ts">
  import { untrack } from "svelte";
  import type { Input, LogicDef, Output } from "$logic/types";
  import { validateLogicDocument } from "$logic/validate";
  import { getVariables } from "$lib/stores/variables.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import InputsEditor from "./InputsEditor.svelte";
  import OutputEditor from "./OutputEditor.svelte";
  import ExprEditor from "./ExprEditor.svelte";
  import MachineEditor from "./MachineEditor.svelte";

  let {
    logic,
    onchange,
    onClose,
  }: {
    logic: LogicDef;
    onchange: (logic: LogicDef) => void;
    onClose: () => void;
  } = $props();

  /** Edits happen on a copy: the document (and the adapter) only sees them on
   *  Save, so typing does not reload the logic engine. */
  let draft = $state(untrack(() => structuredClone(logic)));
  let askClose = $state(false);

  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(logic));
  const issues = $derived(
    validateLogicDocument({ version: 1, logics: [draft] }).filter(
      (issue) => issue.logicId === draft.id,
    ),
  );
  const canSave = $derived(
    dirty && !issues.some((issue) => issue.severity === "error"),
  );

  const output = $derived<Output>(
    draft.output ?? { scope: "memory", name: draft.id },
  );
  const stateNames = $derived(
    draft.kind === "machine" ? Object.keys(draft.states) : [],
  );

  function patch(update: Partial<LogicDef>) {
    draft = { ...draft, ...update } as LogicDef;
  }

  /** A state id that a global variable stands for becomes the variable's name,
   *  so changing the variable later changes every logic that uses it. */
  function normalizeRefs(logic: LogicDef): LogicDef {
    const vars = getVariables().filter((v) => v.kind === "state" && v.stateId);
    const toName = (ref: string) =>
      vars.find((v) => v.stateId === ref)?.name ?? ref;
    const inputs = Object.fromEntries(
      Object.entries(logic.inputs ?? {}).map(([name, input]) => {
        if (input.from.type !== "state") return [name, input];
        return [
          name,
          {
            ...input,
            from: {
              ...input.from,
              ref: toName(input.from.ref),
              refs: (input.from.refs ?? []).map(toName),
            },
          },
        ];
      }),
    ) as LogicDef["inputs"];
    const output =
      logic.output?.scope === "state"
        ? { ...logic.output, ref: toName(logic.output.ref) }
        : logic.output;
    return { ...logic, inputs, output } as LogicDef;
  }

  function save() {
    if (canSave) onchange(normalizeRefs(draft));
  }

  function cancel() {
    draft = structuredClone(logic);
  }

  function close() {
    if (dirty) askClose = true;
    else onClose();
  }

  function renameRefs(value: unknown, from: string, to: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => renameRefs(item, from, to));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if ((key === "ref" || key === "on") && item === from) out[key] = to;
        else out[key] = renameRefs(item, from, to);
      }
      return out;
    }
    return value;
  }

  /** Renaming an input rewrites its rows, conditions and set targets. */
  function renameInput(oldName: string, newName: string) {
    const inputs = draft.inputs ?? {};
    if (!newName || newName === oldName || newName in inputs) return;
    const rebuilt: Record<string, Input> = {};
    for (const [key, value] of Object.entries(inputs)) {
      rebuilt[key === oldName ? newName : key] = value;
    }
    const rest = { ...draft } as Record<string, unknown>;
    delete rest.inputs;
    draft = {
      ...(renameRefs(rest, oldName, newName) as object),
      inputs: rebuilt,
    } as LogicDef;
  }
</script>

<section class="card editor">
  <div class="card-header editor-head">
    <label class="label-mono" for="logic-name">Name</label>
    <input
      id="logic-name"
      class="logic-name"
      value={draft.name}
      onchange={(e) =>
        patch({ name: e.currentTarget.value.trim() || draft.id })}
    />
    <span class="badge badge-secondary">{draft.kind}</span>
    <label class="inline"
      >enabled <input
        type="checkbox"
        checked={draft.enabled !== false}
        onchange={(e) => patch({ enabled: e.currentTarget.checked })}
      /></label
    >
    <label class="inline" title="Log state changes to the adapter log"
      >log <input
        type="checkbox"
        checked={draft.log === true}
        onchange={(e) => patch({ log: e.currentTarget.checked || undefined })}
      /></label
    >
    <span class="actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!canSave}
        onclick={save}>Save</button
      >
      <button
        type="button"
        class="btn btn-sm"
        disabled={!dirty}
        onclick={cancel}>Cancel</button
      >
      <IconButton
        icon="close"
        label="Close the editor"
        title="Close"
        onclick={close}
      />
    </span>
  </div>

  <div class="card-body editor-body">
    <div class="block">
      <span class="label-mono">Output</span>
      <OutputEditor
        {output}
        {stateNames}
        onchange={(next) => patch({ output: next })}
      />
    </div>

    <div class="block">
      <InputsEditor
        inputs={draft.inputs ?? {}}
        onchange={(inputs) => patch({ inputs })}
        onRename={renameInput}
        where={draft.name}
      />
    </div>

    {#if draft.kind === "function"}
      <div class="block">
        <span class="label-mono">Result expression</span>
        <ExprEditor
          expr={draft.expr}
          allowNoop
          onchange={(expr) => patch({ expr })}
        />
      </div>
    {:else}
      <MachineEditor logic={draft} onchange={(next) => (draft = next)} />
    {/if}

    {#if issues.length > 0}
      <ul class="issues">
        {#each issues as issue (issue.path + issue.message)}
          <li class:text-danger={issue.severity === "error"}>
            <span class="mono">{issue.path}</span> — {issue.message}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

{#if askClose}
  <ConfirmModal
    title="Discard unsaved changes?"
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={() => {
      askClose = false;
      onClose();
    }}
    onCancel={() => (askClose = false)}
  />
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
  }

  .editor-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: nowrap;
  }

  .editor-head .badge,
  .editor-head .inline,
  .editor-head .label-mono {
    flex: 0 0 auto;
  }

  .logic-name {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
    flex: 0 0 auto;
  }

  .editor-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .issues {
    margin: 0;
    padding: 0.5rem 0.75rem 0.5rem 1.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--body-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
  }
</style>
