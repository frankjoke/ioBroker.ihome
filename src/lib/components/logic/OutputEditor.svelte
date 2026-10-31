<script lang="ts">
  import type { Output } from "$logic/types";
  import StateRefField from "./StateRefField.svelte";

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

  function setMap(state: string, raw: string) {
    if (output.scope !== "state") return;
    const map = { ...(output.map ?? {}) };
    if (raw === "") delete map[state];
    else map[state] = output.type === "boolean" ? raw === "true" : Number(raw);
    onchange({ ...output, map });
  }
</script>

<div class="output">
  <div class="row">
    <span class="label-mono">Writes to</span>
    <select
      aria-label="Output scope"
      value={output.scope}
      onchange={(e) =>
        onchange(
          e.currentTarget.value === "memory"
            ? { scope: "memory", name: "", forward: output.forward }
            : {
                scope: "state",
                ref: "",
                type: "boolean",
                forward: output.forward,
              },
        )}
    >
      <option value="memory">Adapter memory (internal)</option>
      <option value="state">ioBroker state</option>
    </select>
  </div>

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
      <label class="inline"
        >forward every time <input
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
  {:else}
    <div class="row">
      <span class="label-mono">State</span>
      <StateRefField
        value={output.ref}
        label="Output state"
        onchange={(ref) => onchange({ ...output, ref })}
      />
    </div>
    <div class="row">
      <span class="label-mono">Type</span>
      <select
        aria-label="Output type"
        value={output.type}
        onchange={(e) =>
          onchange({
            ...output,
            type: e.currentTarget.value as (typeof TYPE)[number],
            map: undefined,
          })}
      >
        {#each TYPE as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>
      <label class="inline"
        >forward every time <input
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
    {#if output.type !== "string" && stateNames.length > 0}
      <div class="map">
        <span class="label-mono">Value per state</span>
        {#each stateNames as state (state)}
          <label class="map-row"
            ><span class="mono">{state}</span>
            {#if output.type === "boolean"}
              <select
                aria-label={`Value for ${state}`}
                value={String(output.map?.[state] ?? state.startsWith("On"))}
                onchange={(e) => setMap(state, e.currentTarget.value)}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            {:else}
              <input
                type="number"
                aria-label={`Value for ${state}`}
                value={String(output.map?.[state] ?? "")}
                placeholder="required"
                onchange={(e) => setMap(state, e.currentTarget.value)}
              />
            {/if}
          </label>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .output {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row,
  .inline,
  .map-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .map {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .map-row {
    justify-content: flex-start;
  }

  .map-row .mono {
    min-width: 8rem;
  }
</style>
