<script lang="ts">
  import type { Output } from "$logic/types";
  import type { LogicDef } from "$logic/types";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { variableNameFor } from "$lib/config/variables";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";

  let {
    output,
    stateNames,
    logicId,
    logics = [],
    onchange,
  }: {
    output: Output;
    stateNames: string[];
    /** The logic id, for the derived logic-state id. */
    logicId: string;
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
    onchange: (output: Output) => void;
  } = $props();

  const TYPE = ["boolean", "number", "string"] as const;

  const stateRef = $derived(output.scope === "state" ? output.ref : "");
  const logicStateId = $derived(`${ioBroker.namespace}.Logic.${logicId}`);
  /** A logic cannot target its own output state. */
  const otherLogics = $derived(logics.filter((logic) => logic.id !== logicId));
  let picking = $state(false);

  /** Selecting "Existing state" must not change the target until a state is
   *  actually picked: the picker opens and the select keeps the real target. */
  function chooseScope(select: HTMLSelectElement): void {
    const scope = select.value as "memory" | "logic" | "state";
    if (scope === "state" && !stateRef) {
      picking = true;
      select.value = output.scope;
      return;
    }
    setTarget(scope);
  }

  /** The three kinds of output target. */
  function setTarget(scope: "memory" | "logic" | "state") {
    if (scope === "memory") {
      onchange({
        scope: "memory",
        name: output.scope === "memory" ? output.name : "",
        forward: output.forward,
      });
      return;
    }
    if (scope === "logic") {
      onchange({
        scope: "logic",
        type: output.scope === "memory" ? "boolean" : output.type,
        on: output.scope === "memory" ? undefined : output.on,
        map: output.scope === "memory" ? undefined : output.map,
        forward: output.forward,
      });
      return;
    }
    // An existing state needs a ref: keep the current one, else pick.
    if (stateRef) {
      onchange({
        scope: "state",
        ref: stateRef,
        type: output.scope === "memory" ? "boolean" : output.type,
        on: output.scope === "memory" ? undefined : output.on,
        map: output.scope === "memory" ? undefined : output.map,
        forward: output.forward,
      });
      return;
    }
    picking = true;
  }

  function realId(ref: string): string {
    return (
      getVariables().find((v) => v.kind === "state" && v.name === ref)
        ?.stateId ?? ref
    );
  }

  /** The selected state's declared type, so the field shows the truth. */
  function stateType(ref: string): (typeof TYPE)[number] | undefined {
    const type = ioBroker.objects.get(realId(ref))?.common?.type;
    if (type === "boolean" || type === "number" || type === "string") {
      return type;
    }
    return undefined;
  }

  const shownType = $derived(
    output.scope === "state" ? (stateType(stateRef) ?? output.type) : "boolean",
  );

  /** The selected state's unit; a foreign state is never written to. */
  function stateUnit(ref: string): string {
    return String(ioBroker.objects.get(realId(ref))?.common?.unit ?? "");
  }

  /** One field: a state is the output; no state means adapter memory. */
  function setRef(ref: string) {
    if (!ref) {
      onchange({
        scope: "memory",
        name: output.scope === "memory" ? output.name : "",
        forward: output.forward,
      });
      return;
    }
    onchange({
      scope: "state",
      ref,
      // The state's own type wins; it is what the engine will write.
      type:
        stateType(ref) ?? (output.scope === "state" ? output.type : "boolean"),
      map: output.scope === "state" ? output.map : undefined,
      forward: output.forward,
    });
  }
</script>

<div class="output">
  <div class="row">
    <span class="label-mono">Target</span>
    <select
      aria-label="Output target"
      value={output.scope}
      onchange={(e) => chooseScope(e.currentTarget)}
    >
      <option value="logic">ihome state</option>
      <option value="state">Existing state</option>
      <option value="memory">Memory</option>
    </select>
    {#if output.scope === "logic"}
      <span class="state-name mono" title={logicStateId}>{logicStateId}</span>
      <select
        class="type"
        aria-label="Output type"
        value={output.type}
        onchange={(e) =>
          onchange({
            ...output,
            type: e.currentTarget.value as "boolean" | "number" | "string",
          })}
      >
        {#each TYPE as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>
      {#if output.type === "number"}
        <input
          class="unit"
          aria-label="Output unit"
          placeholder="unit"
          value={output.unit ?? ""}
          onchange={(e) =>
            onchange({
              ...output,
              unit: e.currentTarget.value.trim() || undefined,
            })}
        />
      {/if}
    {:else if output.scope === "state"}
      <span
        class="state-name mono"
        title={variableNameFor(stateRef, getVariables())}
        >{variableNameFor(stateRef, getVariables())}</span
      >
      <IconButton
        icon="close"
        label="Clear the output state"
        title="Clear the state (use memory)"
        onclick={() => setRef("")}
      />
      <select
        class="type"
        aria-label="Output type"
        value={shownType}
        disabled
        title="The type comes from the selected state"
      >
        {#each TYPE as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>
      {#if shownType === "number"}
        <input
          class="unit"
          aria-label="Output unit"
          value={stateUnit(stateRef)}
          disabled
          title="The unit comes from the selected state"
        />
      {/if}
    {/if}
    <label class="inline write-always"
      >write always <input
        type="checkbox"
        checked={output.forward === "always"}
        onchange={(e) =>
          onchange({
            ...output,
            forward: e.currentTarget.checked ? "always" : "changed",
          })}
      /></label
    >
  </div>

  {#if picking}
    <SourcePicker
      mode="state"
      title="Output state"
      logics={otherLogics}
      logicPick="state"
      onState={(id) => {
        setRef(id);
        picking = false;
      }}
      onClose={() => (picking = false)}
    />
  {/if}

  {#if output.scope !== "memory" && output.type === "boolean" && stateNames.length > 0}
    <div class="row">
      <span class="label-mono">True for states</span>
      <input
        class="mono"
        aria-label="True state pattern"
        value={output.on ?? "On*"}
        placeholder="On*"
        onchange={(e) =>
          onchange({
            ...output,
            on: e.currentTarget.value.trim() || "On*",
          })}
      />
      <span class="hint text-muted"> * matches all; will be true </span>
    </div>
  {:else if output.scope !== "memory" && output.type === "number" && stateNames.length > 0}
    <div class="row">
      <span class="label-mono">Values</span>
      <span class="hint text-muted">state index, in this order:</span>
      <span class="mono">
        {stateNames.map((state, index) => `${index} = ${state}`).join(" · ")}
      </span>
    </div>
  {/if}
</div>

<style>
  .output {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row,
  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  .row input:not([type="checkbox"]) {
    flex: 1 1 auto;
    min-width: 6rem;
  }

  .state-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .write-always {
    margin-left: auto;
    flex: 0 0 auto;
  }

  .type {
    flex: 0 0 auto;
  }

  .row input.unit {
    flex: 0 0 5rem;
    min-width: 5rem;
  }
</style>
