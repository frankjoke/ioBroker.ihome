<script lang="ts">
  import type { LogicDef, Output } from "$logic/types";
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

  const output = $derived<Output>(
    logic.output ?? { scope: "memory", name: logic.id },
  );
  const stateNames = $derived(
    logic.kind === "machine" ? Object.keys(logic.states) : [],
  );

  function patch(update: Partial<LogicDef>) {
    onchange({ ...logic, ...update } as LogicDef);
  }
</script>

<section class="card editor">
  <div class="card-header editor-head">
    <input
      class="logic-name"
      aria-label="Logic name"
      value={logic.name}
      onchange={(e) =>
        patch({ name: e.currentTarget.value.trim() || logic.id })}
    />
    <label class="inline"
      >enabled <input
        type="checkbox"
        checked={logic.enabled !== false}
        onchange={(e) => patch({ enabled: e.currentTarget.checked })}
      /></label
    >
    <span class="badge badge-secondary">{logic.kind}</span>
    <button type="button" class="btn btn-sm" onclick={onClose}>Close</button>
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
      <span class="label-mono">Inputs &amp; events</span>
      <InputsEditor
        inputs={logic.inputs ?? {}}
        onchange={(inputs) => patch({ inputs })}
      />
    </div>

    {#if logic.kind === "function"}
      <div class="block">
        <span class="label-mono">Result expression</span>
        <ExprEditor
          expr={logic.expr}
          allowNoop
          onchange={(expr) => patch({ expr })}
        />
      </div>
    {:else}
      <div class="block">
        <span class="label-mono">States</span>
        <MachineEditor {logic} onchange={(next) => onchange(next)} />
      </div>
    {/if}
  </div>
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
  }

  .editor-head {
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .logic-name {
    flex: 1 1 12rem;
    font-weight: 600;
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
</style>
