<script lang="ts">
  import type { Output } from "$logic/types";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";

  let {
    output,
    stateNames,
    onchange,
  }: {
    output: Output;
    stateNames: string[];
    onchange: (output: Output) => void;
  } = $props();

  const TYPE = ["boolean", "number", "string"] as const;

  const stateRef = $derived(output.scope === "state" ? output.ref : "");
  let picking = $state(false);

  /** The selected state's declared type, so the field shows the truth. */
  function stateType(ref: string): (typeof TYPE)[number] | undefined {
    const type = ioBroker.objects.get(ref)?.common?.type;
    if (type === "boolean" || type === "number" || type === "string") {
      return type;
    }
    return undefined;
  }

  const shownType = $derived(
    output.scope === "state" ? (stateType(stateRef) ?? output.type) : "boolean",
  );

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
    <span class="label-mono">State</span>
    <span
      class="state-value"
      class:mono={stateRef !== ""}
      class:text-muted={stateRef === ""}
    >
      {stateRef || "Memory - Select if to be written"}
    </span>
    <IconButton
      icon={stateRef ? "close" : "search"}
      label={stateRef ? "Clear the output state" : "Select the output state"}
      title={stateRef ? "Clear the state (use memory)" : "Select a state"}
      onclick={() => {
        if (stateRef) setRef("");
        else picking = true;
      }}
    />
    {#if output.scope === "state"}
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
      onState={(id) => {
        setRef(id);
        picking = false;
      }}
      onClose={() => (picking = false)}
    />
  {/if}

  {#if output.scope === "memory"}
    <div class="row">
      <span class="label-mono">Memory name</span>
      <input
        aria-label="Memory name"
        value={output.name ?? ""}
        placeholder="defaults to the logic id"
        onchange={(e) =>
          onchange({
            ...output,
            name: e.currentTarget.value.trim() || undefined,
          })}
      />
    </div>
  {:else if output.type === "boolean"}
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
      <span class="hint text-muted">
        * matches any name; every other state writes false
      </span>
    </div>
  {:else if output.type === "number" && stateNames.length > 0}
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

  .state-value {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .write-always {
    margin-left: auto;
    flex: 0 0 auto;
  }

  .type {
    flex: 0 0 auto;
  }
</style>
