<script lang="ts">
  import type { Input, InputSource } from "$logic/types";
  import IconButton from "$lib/components/common/IconButton.svelte";
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

  /** The row whose fields are open; one at a time. */
  let editing = $state<string | null>(null);

  function update(name: string, input: Input) {
    onchange({ ...inputs, [name]: input });
  }

  function rename(oldName: string, rawName: string) {
    const name = rawName.trim();
    if (!name || (name !== oldName && name in inputs)) return;
    if (onRename) {
      onRename(oldName, name);
    } else {
      const next: Record<string, Input> = {};
      for (const [key, value] of Object.entries(inputs)) {
        next[key === oldName ? name : key] = value;
      }
      onchange(next);
    }
    if (editing === oldName) editing = name;
  }

  function remove(name: string) {
    const next = { ...inputs };
    delete next[name];
    onchange(next);
    if (editing === name) editing = null;
  }

  function add() {
    let index = Object.keys(inputs).length + 1;
    let name = `input${index}`;
    while (name in inputs) name = `input${++index}`;
    onchange({
      ...inputs,
      [name]: { from: { type: "state", ref: "" }, kind: "event" },
    });
    editing = name;
  }

  function setSource(name: string, input: Input, type: InputSource["type"]) {
    const from: InputSource =
      type === "timer" ? { type: "timer", every: "30s" } : { type, ref: "" };
    update(name, { ...input, from });
  }

  function sourceLabel(input: Input): string {
    if (input.from.type === "state")
      return input.from.ref || "(no state selected)";
    if (input.from.type === "memory")
      return input.from.ref || "(no memory name)";
    return `every ${input.from.every}`;
  }

  function kindLabel(input: Input): string {
    if (input.from.type === "timer") return "event";
    return input.kind === "event" ? "event" : "variable";
  }
</script>

<div class="inputs">
  <div class="inputs-head">
    <span class="label-mono">Inputs &amp; events</span>
    <span class="add-slot">
      <IconButton
        icon="add"
        label="Add input"
        title="Add input"
        onclick={add}
      />
    </span>
  </div>

  {#each Object.entries(inputs) as [name, input] (name)}
    <div class="input-row" class:open={editing === name}>
      <div class="summary">
        <span class="input-name mono">{name}</span>
        <span class="input-source mono text-muted">{sourceLabel(input)}</span>
        <span class="badge badge-secondary">{kindLabel(input)}</span>
        <span class="spacer"></span>
        <IconButton
          icon={editing === name ? "expand_less" : "edit"}
          label={`Edit ${name}`}
          title={editing === name ? "Close" : "Edit"}
          active={editing === name}
          onclick={() => (editing = editing === name ? null : name)}
        />
        <IconButton
          icon="delete"
          label={`Delete ${name}`}
          title="Delete"
          color="var(--danger-color)"
          onclick={() => remove(name)}
        />
      </div>

      {#if editing === name}
        <div class="fields">
          <label class="field"
            ><span class="label-mono">Name</span>
            <input
              value={name}
              aria-label={`Name for ${name}`}
              onchange={(e) => rename(name, e.currentTarget.value)}
            />
          </label>
          <label class="field"
            ><span class="label-mono">Source</span>
            <select
              aria-label={`Source type for ${name}`}
              value={input.from.type}
              onchange={(e) =>
                setSource(
                  name,
                  input,
                  e.currentTarget.value as InputSource["type"],
                )}
            >
              <option value="state">State / variable</option>
              <option value="memory">Memory</option>
              <option value="timer">Timer</option>
            </select>
          </label>

          {#if input.from.type === "state"}
            <div class="field wide">
              <span class="label-mono">State</span>
              <StateRefField
                value={input.from.ref}
                label={`State for ${name}`}
                onchange={(ref) =>
                  update(name, { ...input, from: { type: "state", ref } })}
              />
            </div>
            <label class="field"
              ><span class="label-mono">Kind</span>
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
            </label>
            {#if (input.kind ?? "variable") === "event"}
              <label class="field"
                ><span class="label-mono">Mode</span>
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
              </label>
              <label class="field"
                ><span class="label-mono">Ack</span>
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
              </label>
              <label class="field"
                ><span class="label-mono">Source</span>
                <select
                  aria-label={`Source for ${name}`}
                  value={input.source ?? "external"}
                  onchange={(e) =>
                    update(name, {
                      ...input,
                      source: e.currentTarget.value as
                        "external" | "self" | "any",
                    })}
                >
                  <option value="external">external sources</option>
                  <option value="self">own writes</option>
                  <option value="any">any source</option>
                </select>
              </label>
            {/if}
          {:else if input.from.type === "memory"}
            <label class="field"
              ><span class="label-mono">Memory</span>
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
            </label>
            <label class="field"
              ><span class="label-mono">Kind</span>
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
            </label>
          {:else}
            <label class="field"
              ><span class="label-mono">Every</span>
              <input
                class="mono"
                aria-label={`Every for ${name}`}
                placeholder="30s / 2m / 1h"
                value={input.from.every}
                onchange={(e) =>
                  update(name, {
                    ...input,
                    from: {
                      type: "timer",
                      every: e.currentTarget.value.trim(),
                    },
                  })}
              />
            </label>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if Object.keys(inputs).length === 0}
    <p class="hint text-muted">No inputs yet — use the + on the line above.</p>
  {/if}
</div>

<style>
  .inputs {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .inputs-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .add-slot {
    margin-left: auto;
    display: inline-flex;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px dashed var(--border-color);
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .input-name {
    font-weight: 600;
  }

  .input-source {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.8rem;
    padding: 0.4rem 0 0.2rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 7rem;
  }

  .field.wide {
    flex: 1 1 18rem;
  }

  .field input,
  .field select {
    width: 100%;
  }
</style>
