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

  const stateRef = $derived(output.scope === "state" ? output.ref : "");

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
      type: output.scope === "state" ? output.type : "boolean",
      map: output.scope === "state" ? output.map : undefined,
      forward: output.forward,
    });
  }

  function setMap(state: string, raw: string) {
    if (output.scope !== "state") return;
    const map: Record<string, string | number | boolean> = {
      ...(output.map ?? {}),
    };
    // The first edit seeds every state with the value the select already
    // shows, so the document never has a partially filled map.
    if (!output.map) {
      for (const name of stateNames) {
        map[name] = output.type === "boolean" ? name.startsWith("On") : 0;
      }
    }
    if (raw === "") delete map[state];
    else map[state] = output.type === "boolean" ? raw === "true" : Number(raw);
    onchange({ ...output, map });
  }
</script>

<div class="output">
  <div class="row">
    <span class="label-mono">Output state</span>
    <StateRefField
      value={stateRef}
      label="Output state"
      onchange={(ref) => setRef(ref)}
    />
    {#if output.scope === "memory"}
      <span class="hint text-muted">empty = adapter memory</span>
    {/if}
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
