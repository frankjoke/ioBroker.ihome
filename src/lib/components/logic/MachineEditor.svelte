<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { MachineLogic, OnRow, StateDef } from "$logic/types";
  import ActionList from "./ActionList.svelte";
  import ExprEditor from "./ExprEditor.svelte";

  let {
    logic,
    onchange,
  }: {
    logic: MachineLogic;
    onchange: (logic: MachineLogic) => void;
  } = $props();

  const stateNames = $derived(Object.keys(logic.states));
  const eventInputs = $derived(
    Object.entries(logic.inputs ?? {})
      .filter(
        ([, input]) => input.kind === "event" || input.from.type === "timer",
      )
      .map(([name]) => name),
  );

  function patch(update: Partial<MachineLogic>) {
    onchange({ ...logic, ...update });
  }

  function updateState(name: string, state: StateDef) {
    patch({ states: { ...logic.states, [name]: state } });
  }

  function addState() {
    let index = stateNames.length + 1;
    let name = `State${index}`;
    while (name in logic.states) name = `State${++index}`;
    patch({ states: { ...logic.states, [name]: {} } });
  }

  function removeState(name: string) {
    if (stateNames.length <= 1) return;
    const states = { ...logic.states };
    delete states[name];
    const fallback = Object.keys(states)[0];
    const rewritten: Record<string, StateDef> = {};
    for (const [key, state] of Object.entries(states)) {
      rewritten[key] = {
        ...state,
        after: state.after
          ? {
              ...state.after,
              goto: state.after.goto === name ? fallback : state.after.goto,
            }
          : undefined,
        on: state.on?.map((row) => ({
          ...row,
          goto: row.goto === name ? fallback : row.goto,
        })),
      };
    }
    onchange({
      ...logic,
      start: logic.start === name ? fallback : logic.start,
      states: rewritten,
    });
  }

  function renameState(oldName: string, rawName: string) {
    const name = rawName.trim();
    if (!name || (name !== oldName && name in logic.states)) return;
    const states: Record<string, StateDef> = {};
    for (const [key, state] of Object.entries(logic.states)) {
      const nextName = key === oldName ? name : key;
      states[nextName] = {
        ...state,
        after: state.after
          ? {
              ...state.after,
              goto: state.after.goto === oldName ? name : state.after.goto,
            }
          : undefined,
        on: state.on?.map((row) => ({
          ...row,
          goto: row.goto === oldName ? name : row.goto,
        })),
      };
    }
    onchange({
      ...logic,
      start: logic.start === oldName ? name : logic.start,
      states,
    });
  }

  function updateRow(stateName: string, index: number, row: OnRow) {
    const state = logic.states[stateName];
    const on = [...(state.on ?? [])];
    on[index] = row;
    updateState(stateName, { ...state, on });
  }

  function removeRow(stateName: string, index: number) {
    const state = logic.states[stateName];
    updateState(stateName, {
      ...state,
      on: (state.on ?? []).filter((_, i) => i !== index),
    });
  }

  function addRow(stateName: string) {
    const state = logic.states[stateName];
    const input = eventInputs[0] ?? "$init";
    updateState(stateName, {
      ...state,
      on: [...(state.on ?? []), { on: input }],
    });
  }

  function parseValue(raw: string): string | number | boolean {
    if (raw === "true") return true;
    if (raw === "false") return false;
    const number = Number(raw);
    return raw.trim() !== "" && Number.isFinite(number) ? number : raw;
  }
</script>

<div class="machine">
  <div class="row">
    <span class="label-mono">Start state</span>
    <select
      aria-label="Start state"
      value={logic.start ?? stateNames[0] ?? ""}
      onchange={(e) => patch({ start: e.currentTarget.value })}
    >
      {#each stateNames as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
    <button type="button" class="btn btn-sm" onclick={addState}
      >Add state</button
    >
  </div>

  {#each Object.entries(logic.states) as [name, state] (name)}
    <section class="state">
      <div class="row">
        <input
          class="state-name"
          aria-label="State name"
          value={name}
          onchange={(e) => renameState(name, e.currentTarget.value)}
        />
        <IconButton
          icon="delete"
          label={`Delete ${name}`}
          disabled={stateNames.length <= 1}
          onclick={() => removeState(name)}
        />
      </div>

      <div class="block">
        <span class="label-mono">On enter</span>
        <ActionList
          actions={state.enter ?? []}
          onchange={(enter) => updateState(name, { ...state, enter })}
        />
      </div>
      <div class="block">
        <span class="label-mono">On exit</span>
        <ActionList
          actions={state.exit ?? []}
          onchange={(exit) => updateState(name, { ...state, exit })}
        />
      </div>

      <div class="row">
        <label class="inline"
          >after
          <input
            class="duration"
            aria-label={`After time for ${name}`}
            placeholder="2m"
            value={state.after?.time ?? ""}
            onchange={(e) =>
              updateState(name, {
                ...state,
                after: e.currentTarget.value.trim()
                  ? {
                      time: e.currentTarget.value.trim(),
                      goto:
                        state.after?.goto ??
                        stateNames.find((s) => s !== name) ??
                        name,
                    }
                  : undefined,
              })}
          />
        </label>
        <label class="inline"
          >goto
          <select
            aria-label={`After target for ${name}`}
            value={state.after?.goto ?? ""}
            onchange={(e) =>
              updateState(name, {
                ...state,
                after: state.after
                  ? { ...state.after, goto: e.currentTarget.value }
                  : {
                      time: "1m",
                      goto: e.currentTarget.value,
                    },
              })}
          >
            <option value="">— none —</option>
            {#each stateNames as target (target)}
              <option value={target}>{target}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="block">
        <span class="label-mono">When</span>
        {#each state.on ?? [] as row, index (index)}
          <div class="row-card">
            <div class="row">
              <select
                aria-label="Event input"
                value={row.on}
                onchange={(e) =>
                  updateRow(name, index, { ...row, on: e.currentTarget.value })}
              >
                <option value="$init">$init (start)</option>
                {#each eventInputs as input (input)}
                  <option value={input}>{input}</option>
                {/each}
              </select>
              <select
                aria-label="Value test"
                value={row.is?.op ?? ""}
                onchange={(e) => {
                  const op = e.currentTarget.value;
                  updateRow(name, index, {
                    ...row,
                    is: op
                      ? { op: op as "eq", value: row.is?.value ?? true }
                      : undefined,
                  });
                }}
              >
                <option value="">any change</option>
                <option value="eq">=</option>
                <option value="ne">≠</option>
                <option value="gt">&gt;</option>
                <option value="gte">≥</option>
                <option value="lt">&lt;</option>
                <option value="lte">≤</option>
              </select>
              {#if row.is}
                <input
                  class="is-value"
                  aria-label="Compare value"
                  value={String(row.is.value ?? "")}
                  onchange={(e) =>
                    updateRow(name, index, {
                      ...row,
                      is: {
                        op: row.is!.op,
                        value: parseValue(e.currentTarget.value),
                      },
                    })}
                />
              {/if}
              <IconButton
                icon="remove"
                label="Remove row"
                onclick={() => removeRow(name, index)}
              />
            </div>

            <div class="block">
              {#if row.if}
                <div class="row">
                  <span class="label-mono">if</span>
                  <ExprEditor
                    expr={row.if}
                    onchange={(next) => {
                      if ("noop" in next) return;
                      updateRow(name, index, { ...row, if: next });
                    }}
                  />
                  <button
                    type="button"
                    class="btn btn-sm"
                    onclick={() =>
                      updateRow(name, index, { ...row, if: undefined })}
                    >Remove condition</button
                  >
                </div>
              {:else}
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() =>
                    updateRow(name, index, { ...row, if: { ref: "" } })}
                  >Add condition</button
                >
              {/if}
            </div>

            <div class="block">
              <span class="label-mono">Then</span>
              <ActionList
                actions={row.do ?? []}
                {stateNames}
                onchange={(actions) =>
                  updateRow(name, index, { ...row, do: actions })}
              />
            </div>

            <div class="row">
              <span class="label-mono">goto</span>
              <select
                aria-label="Target state"
                value={row.goto ?? ""}
                onchange={(e) =>
                  updateRow(name, index, {
                    ...row,
                    goto: e.currentTarget.value || undefined,
                  })}
              >
                <option value="">— stay —</option>
                {#each stateNames as target (target)}
                  <option value={target}>{target}</option>
                {/each}
              </select>
            </div>
          </div>
        {/each}
        <button type="button" class="btn btn-sm" onclick={() => addRow(name)}
          >Add row</button
        >
        {#if eventInputs.length === 0}
          <p class="hint text-muted">
            Add an event input above to give this state a trigger.
          </p>
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  .machine {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .state {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    padding: 0.7rem;
  }

  .row,
  .inline,
  .block {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .block {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .row-card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.5rem;
    border-left: 2px solid var(--border-color);
    width: 100%;
  }

  .state-name {
    width: 10rem;
    font-weight: 600;
  }

  .duration,
  .is-value {
    width: 6rem;
  }
</style>
