<script lang="ts">
  import type { Input, InputSource } from "$logic/types";
  import StateRefField from "./StateRefField.svelte";

  let {
    inputs,
    onchange,
    onRename,
  }: {
    inputs: Record<string, Input>;
    onchange: (inputs: Record<string, Input>) => void;
    /** Rewrites every reference when the parent can (preferred). */
    onRename?: (oldName: string, newName: string) => void;
  } = $props();

  function update(name: string, input: Input) {
    onchange({ ...inputs, [name]: input });
  }

  function rename(oldName: string, rawName: string) {
    const name = rawName.trim();
    if (!name || (name !== oldName && name in inputs)) return;
    if (onRename) {
      onRename(oldName, name);
      return;
    }
    const next: Record<string, Input> = {};
    for (const [key, value] of Object.entries(inputs)) {
      next[key === oldName ? name : key] = value;
    }
    onchange(next);
  }

  function remove(name: string) {
    const next = { ...inputs };
    delete next[name];
    onchange(next);
  }

  function add() {
    let index = Object.keys(inputs).length + 1;
    let name = `input${index}`;
    while (name in inputs) name = `input${++index}`;
    onchange({
      ...inputs,
      [name]: { from: { type: "state", ref: "" }, kind: "event" },
    });
  }

  function setSource(name: string, input: Input, type: InputSource["type"]) {
    const from: InputSource =
      type === "timer" ? { type: "timer", every: "30s" } : { type, ref: "" };
    update(name, { ...input, from });
  }
</script>

<div class="inputs">
  {#each Object.entries(inputs) as [name, input] (name)}
    <div class="input-row">
      <input
        class="name"
        aria-label="Input name"
        value={name}
        onchange={(e) => rename(name, e.currentTarget.value)}
      />
      <select
        aria-label={`Source type for ${name}`}
        value={input.from.type}
        onchange={(e) =>
          setSource(name, input, e.currentTarget.value as InputSource["type"])}
      >
        <option value="state">State / variable</option>
        <option value="memory">Memory</option>
        <option value="timer">Timer</option>
      </select>

      {#if input.from.type === "state"}
        <StateRefField
          value={input.from.ref}
          label={`State for ${name}`}
          onchange={(ref) =>
            update(name, { ...input, from: { type: "state", ref } })}
        />
        <select
          aria-label={`Kind for ${name}`}
          value={input.kind ?? "variable"}
          onchange={(e) =>
            update(name, {
              ...input,
              kind: e.currentTarget.value as "variable" | "event",
            })}
        >
          <option value="variable">variable</option>
          <option value="event">event</option>
        </select>
        {#if (input.kind ?? "variable") === "event"}
          <select
            aria-label={`Mode for ${name}`}
            value={input.mode ?? "changed"}
            onchange={(e) =>
              update(name, {
                ...input,
                mode: e.currentTarget.value as "changed" | "any",
              })}
          >
            <option value="changed">on change</option>
            <option value="any">every update</option>
          </select>
          <select
            aria-label={`Ack filter for ${name}`}
            value={input.ack ?? "any"}
            onchange={(e) =>
              update(name, {
                ...input,
                ack: e.currentTarget.value as "any" | "true" | "false",
              })}
          >
            <option value="any">any ack</option>
            <option value="false">commands only</option>
            <option value="true">confirmations only</option>
          </select>
        {/if}
      {:else if input.from.type === "memory"}
        <input
          class="mono"
          aria-label={`Memory name for ${name}`}
          placeholder="memory name"
          value={input.from.ref}
          onchange={(e) =>
            update(name, {
              ...input,
              from: { type: "memory", ref: e.currentTarget.value.trim() },
            })}
        />
        <select
          aria-label={`Kind for ${name}`}
          value={input.kind ?? "variable"}
          onchange={(e) =>
            update(name, {
              ...input,
              kind: e.currentTarget.value as "variable" | "event",
            })}
        >
          <option value="variable">variable</option>
          <option value="event">event</option>
        </select>
      {:else}
        <input
          class="mono"
          aria-label={`Every for ${name}`}
          placeholder="30s / 2m / 1h"
          value={input.from.every}
          onchange={(e) =>
            update(name, {
              ...input,
              from: { type: "timer", every: e.currentTarget.value.trim() },
            })}
        />
        <span class="hint text-muted">fires like an event</span>
      {/if}

      <button
        type="button"
        class="icon-btn"
        aria-label={`Remove ${name}`}
        onclick={() => remove(name)}
      >
        <span class="material-symbols-outlined">remove</span>
      </button>
    </div>
  {/each}

  <button type="button" class="btn btn-sm" onclick={add}>Add input</button>
</div>

<style>
  .inputs {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.4rem 0;
    border-bottom: 1px dashed var(--border-color);
  }

  .input-row .name {
    width: 8rem;
  }
</style>
