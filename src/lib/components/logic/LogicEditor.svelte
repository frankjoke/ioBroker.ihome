<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { Expr, Init, Input, LogicDef, Output } from "$logic/types";
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
  const init = $derived<Init>(logic.init ?? {});
  const canMatch = $derived(
    logic.output?.scope === "state" && !!logic.output.map,
  );

  function patchInit(update: Partial<Init>) {
    const next: Init = { ...(logic.init ?? {}), ...update };
    for (const key of Object.keys(next) as (keyof Init)[]) {
      if (next[key] === undefined) delete next[key];
    }
    patch({ init: Object.keys(next).length > 0 ? next : undefined });
  }

  function patch(update: Partial<LogicDef>) {
    onchange({ ...logic, ...update } as LogicDef);
  }

  function renameRefs(value: unknown, from: string, to: string): unknown {
    if (Array.isArray(value))
      return value.map((item) => renameRefs(item, from, to));
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
    const inputs = logic.inputs ?? {};
    if (!newName || newName === oldName || newName in inputs) return;
    const rebuilt: Record<string, Input> = {};
    for (const [key, value] of Object.entries(inputs)) {
      rebuilt[key === oldName ? newName : key] = value;
    }
    const rest = { ...logic } as Record<string, unknown>;
    delete rest.inputs;
    onchange({
      ...(renameRefs(rest, oldName, newName) as object),
      inputs: rebuilt,
    } as LogicDef);
  }
</script>

<section class="card editor">
  <div class="card-header editor-head">
    <label class="label-mono" for="logic-name">Name</label>
    <input
      id="logic-name"
      class="logic-name"
      value={logic.name}
      onchange={(e) =>
        patch({ name: e.currentTarget.value.trim() || logic.id })}
    />
    <span class="badge badge-secondary">{logic.kind}</span>
    <label class="inline"
      >enabled <input
        type="checkbox"
        checked={logic.enabled !== false}
        onchange={(e) => patch({ enabled: e.currentTarget.checked })}
      /></label
    >
    <span class="close-slot">
      <IconButton
        icon="close"
        label="Close the editor"
        title="Close"
        onclick={onClose}
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
      <span class="label-mono">Inputs &amp; events</span>
      <InputsEditor
        inputs={logic.inputs ?? {}}
        onchange={(inputs) => patch({ inputs })}
        onRename={renameInput}
      />
    </div>

    <div class="block">
      <span class="label-mono">At start</span>
      {#if logic.kind === "function"}
        <label class="inline"
          >run once at start <input
            type="checkbox"
            checked={init.run !== false}
            onchange={(e) =>
              patchInit({ run: e.currentTarget.checked ? undefined : false })}
          /></label
        >
      {:else}
        <label class="inline"
          >take the state from the current output value
          <input
            type="checkbox"
            checked={init.match === "output"}
            disabled={!canMatch}
            onchange={(e) =>
              patchInit({
                match: e.currentTarget.checked ? "output" : undefined,
              })}
          /></label
        >
        {#if !canMatch}
          <span class="hint text-muted">
            Needs an external output with a value map.
          </span>
        {/if}
        {#if init.state !== undefined}
          <div class="row">
            <span class="label-mono">init state</span>
            {#if typeof init.state === "string"}
              <input
                aria-label="Init state name"
                value={init.state}
                onchange={(e) => patchInit({ state: e.currentTarget.value })}
              />
            {:else}
              <ExprEditor
                expr={init.state as Expr}
                onchange={(next) =>
                  patchInit({
                    state: "noop" in next ? undefined : next,
                  })}
              />
            {/if}
            <button
              type="button"
              class="btn btn-sm"
              onclick={() => patchInit({ state: undefined })}>Clear</button
            >
          </div>
        {:else}
          <button
            type="button"
            class="btn btn-sm"
            onclick={() => patchInit({ state: { const: stateNames[0] ?? "" } })}
            >Add init expression</button
          >
        {/if}
        <label class="inline"
          >run $init rows <input
            type="checkbox"
            checked={init.run === true}
            onchange={(e) =>
              patchInit({ run: e.currentTarget.checked || undefined })}
          /></label
        >
      {/if}
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

  .close-slot {
    margin-left: auto;
    display: inline-flex;
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
