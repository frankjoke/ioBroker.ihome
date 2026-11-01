<script lang="ts">
  import type { Input, InputSource } from "$logic/types";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { variableNameFor } from "$lib/config/variables";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import MultiStateField from "./MultiStateField.svelte";
  import StateRefField from "./StateRefField.svelte";

  let {
    inputs,
    onchange,
    onRename,
    where = "",
  }: {
    inputs: Record<string, Input>;
    onchange: (inputs: Record<string, Input>) => void;
    /** Rewrites every reference when the parent can (preferred). */
    onRename?: (oldName: string, newName: string) => void;
    /** The logic name, for the delete confirmation's "from …". */
    where?: string;
  } = $props();

  /** The row whose fields are open; one at a time. */
  let editing = $state<string | null>(null);
  /** Deleting an input always asks first. */
  let pendingDelete = $state<string | null>(null);

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

  function add(kind: "variable" | "event") {
    let index = Object.keys(inputs).length + 1;
    let name = kind === "event" ? `event${index}` : `variable${index}`;
    while (name in inputs) {
      name = `${kind === "event" ? "event" : "variable"}${++index}`;
    }
    const from: InputSource =
      kind === "event"
        ? { type: "state", ref: "", refs: [] }
        : { type: "state", ref: "" };
    onchange({ ...inputs, [name]: { from, kind } });
    editing = name;
  }

  function setSource(name: string, input: Input, type: InputSource["type"]) {
    const from: InputSource =
      type === "timer" ? { type: "timer", every: "30s" } : { type, ref: "" };
    update(name, { ...input, from });
  }

  function sourceLabel(input: Input): string {
    if (input.from.type === "state") {
      const variables = getVariables();
      const all = [input.from.ref, ...(input.from.refs ?? [])]
        .filter(Boolean)
        .map((ref) => variableNameFor(ref, variables));
      if (all.length === 0) return "(no state selected)";
      if (all.length === 1) return all[0];
      return `${all[0]} +${all.length - 1}`;
    }
    if (input.from.type === "memory")
      return input.from.ref || "(no memory name)";
    return `every ${input.from.every}`;
  }
</script>

<div class="inputs">
  <div class="inputs-head">
    <span class="label-mono">Local variables &amp; events</span>
    <span class="add-slot">
      <button type="button" class="btn btn-sm" onclick={() => add("variable")}>
        <span class="material-symbols-outlined">add</span> Variable
      </button>
      <button type="button" class="btn btn-sm" onclick={() => add("event")}>
        <span class="material-symbols-outlined">add</span> Event
      </button>
    </span>
  </div>

  {#each Object.entries(inputs) as [name, input] (name)}
    <div class="input-row">
      <div class="summary">
        <span class="input-name mono">{name}</span>
        <span class="badge badge-secondary">{input.kind}</span>
        <span class="input-source mono text-muted">{sourceLabel(input)}</span>
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
          onclick={() => (pendingDelete = name)}
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
              {#if input.kind === "event"}
                <option value="timer">Timer</option>
              {/if}
            </select>
          </label>

          {#if input.from.type === "state"}
            <div class="field wide">
              <span class="label-mono">
                {input.kind === "event" ? "States" : "State"}
              </span>
              {#if input.kind === "event"}
                <MultiStateField
                  value={[input.from.ref, ...(input.from.refs ?? [])].filter(
                    Boolean,
                  )}
                  label={`States for ${name}`}
                  onchange={(ids) =>
                    update(name, {
                      ...input,
                      from: {
                        type: "state",
                        ref: ids[0] ?? "",
                        refs: ids.slice(1),
                      },
                    })}
                />
              {:else}
                <StateRefField
                  value={input.from.ref}
                  label={`State for ${name}`}
                  onchange={(ref) =>
                    update(name, { ...input, from: { type: "state", ref } })}
                />
              {/if}
            </div>
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
    <p class="hint text-muted">
      No local variables or events yet — use the buttons above.
    </p>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle(
      "input",
      pendingDelete,
      where ? { kind: "logic", name: where } : undefined,
    )}
    confirmLabel="Delete"
    onConfirm={() => {
      if (pendingDelete) remove(pendingDelete);
      pendingDelete = null;
    }}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

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
    flex-wrap: wrap;
  }

  .add-slot {
    margin-left: auto;
    display: inline-flex;
    gap: 0.4rem;
  }

  .add-slot .material-symbols-outlined {
    font-size: 18px;
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
