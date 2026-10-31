<script lang="ts">
  import type { Expr, Init, MachineLogic, OnRow, StateDef } from "$logic/types";
  import ActionList from "./ActionList.svelte";
  import ExprEditor from "./ExprEditor.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";

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

  /** One state and one event row open at a time, like the slot lists. */
  let openState = $state<string | null>(null);
  let openRow = $state<number | null>(null);
  /** The Options tab: $init today, $all and more later. */
  let openOption = $state<"init" | "all" | null>(null);

  const init = $derived<Init>(logic.init ?? {});
  const canMatch = $derived(logic.output?.scope === "state");

  function patchInit(update: Partial<Init>) {
    const next: Init = { ...(logic.init ?? {}), ...update };
    for (const key of Object.keys(next) as (keyof Init)[]) {
      if (next[key] === undefined) delete next[key];
    }
    patch({ init: Object.keys(next).length > 0 ? next : undefined });
  }

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
    openState = name;
    openRow = null;
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
    if (openState === name) {
      openState = null;
      openRow = null;
    }
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
    if (openState === oldName) openState = name;
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
    if (openRow === index) openRow = null;
  }

  function addRow(stateName: string) {
    const state = logic.states[stateName];
    const on = [...(state.on ?? [])];
    on.push({ on: eventInputs[0] ?? "$init" });
    updateState(stateName, { ...state, on });
    openRow = on.length - 1;
  }

  function parseValue(raw: string): string | number | boolean {
    if (raw === "true") return true;
    if (raw === "false") return false;
    const number = Number(raw);
    return raw.trim() !== "" && Number.isFinite(number) ? number : raw;
  }

  function rowSummary(row: OnRow): string {
    const parts = [`on ${row.on}`];
    if (row.is) {
      const value =
        row.is.value === undefined ? "" : ` ${String(row.is.value)}`;
      parts.push(`${row.is.op}${value}`);
    }
    if (row.if) parts.push("if …");
    if (row.do?.length) {
      parts.push(`${row.do.length} action${row.do.length > 1 ? "s" : ""}`);
    }
    if (row.goto) parts.push(`→ ${row.goto}`);
    return parts.join(" · ");
  }
</script>

<div class="machine">
  <div class="options">
    <div class="states-head">
      <span class="label-mono">Options</span>
    </div>
    <div class="option-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="option-tab"
        class:active={openOption === "init"}
        aria-selected={openOption === "init"}
        onclick={() => (openOption = openOption === "init" ? null : "init")}
        >$init</button
      >
      <button
        type="button"
        role="tab"
        class="option-tab"
        class:active={openOption === "all"}
        aria-selected={openOption === "all"}
        onclick={() => (openOption = openOption === "all" ? null : "all")}
        >$all</button
      >
    </div>

    {#if openOption === "init"}
      <div class="option-body">
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
          <span class="hint text-muted"> Needs an external output state. </span>
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
      </div>
    {:else if openOption === "all"}
      <p class="hint text-muted">
        Common rows and actions for every state — the editor follows with the
        input/usage redesign.
      </p>
    {/if}
  </div>

  <div class="states">
    <div class="states-head">
      <span class="label-mono">States</span>
      <span class="add-slot">
        <IconButton
          icon="add"
          label="Add state"
          title="Add state"
          onclick={addState}
        />
      </span>
    </div>

    {#each Object.entries(logic.states) as [name, state] (name)}
      <div class="state-row">
        <div class="summary">
          <span class="state-name mono">{name}</span>
          {#if logic.start ? logic.start === name : stateNames[0] === name}
            <span class="badge badge-secondary">start</span>
          {/if}
          <span class="hint text-muted">
            {(state.on ?? []).length} event{(state.on ?? []).length === 1
              ? ""
              : "s"}{state.after
              ? ` · after ${state.after.time} → ${state.after.goto}`
              : ""}
          </span>
          <span class="spacer"></span>
          <IconButton
            icon={openState === name ? "expand_less" : "edit"}
            label={`Edit ${name}`}
            title={openState === name ? "Close" : "Edit"}
            active={openState === name}
            onclick={() => {
              openState = openState === name ? null : name;
              openRow = null;
            }}
          />
          <IconButton
            icon="delete"
            label={`Delete ${name}`}
            title="Delete"
            color="var(--danger-color)"
            disabled={stateNames.length <= 1}
            onclick={() => removeState(name)}
          />
        </div>

        {#if openState === name}
          <div class="state-body">
            <label class="field"
              ><span class="label-mono">Name</span>
              <input
                value={name}
                aria-label={`Name for ${name}`}
                onchange={(e) => renameState(name, e.currentTarget.value)}
              />
            </label>

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
                        : { time: "1m", goto: e.currentTarget.value },
                    })}
                >
                  <option value="">— none —</option>
                  {#each stateNames as target (target)}
                    <option value={target}>{target}</option>
                  {/each}
                </select>
              </label>
            </div>

            <div class="events">
              <div class="events-head">
                <span class="label-mono">Events</span>
                <span class="add-slot">
                  <IconButton
                    icon="add"
                    label={`Add event to ${name}`}
                    title="Add event"
                    onclick={() => addRow(name)}
                  />
                </span>
              </div>

              {#each state.on ?? [] as row, index (index)}
                <div class="event-row">
                  <div class="summary">
                    <span class="event-summary mono">{rowSummary(row)}</span>
                    <span class="spacer"></span>
                    <IconButton
                      icon={openRow === index ? "expand_less" : "edit"}
                      label={`Edit event ${index + 1} of ${name}`}
                      title={openRow === index ? "Close" : "Edit"}
                      active={openRow === index}
                      onclick={() =>
                        (openRow = openRow === index ? null : index)}
                    />
                    <IconButton
                      icon="delete"
                      label={`Delete event ${index + 1} of ${name}`}
                      title="Delete"
                      color="var(--danger-color)"
                      onclick={() => removeRow(name, index)}
                    />
                  </div>

                  {#if openRow === index}
                    <div class="event-body">
                      <div class="row">
                        <select
                          aria-label="Event input"
                          value={row.on}
                          onchange={(e) =>
                            updateRow(name, index, {
                              ...row,
                              on: e.currentTarget.value,
                            })}
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
                                ? {
                                    op: op as "eq",
                                    value: row.is?.value ?? true,
                                  }
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
                                updateRow(name, index, {
                                  ...row,
                                  if: undefined,
                                })}>Remove condition</button
                            >
                          </div>
                        {:else}
                          <button
                            type="button"
                            class="btn btn-sm"
                            onclick={() =>
                              updateRow(name, index, {
                                ...row,
                                if: { ref: "" },
                              })}>Add condition</button
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
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .machine,
  .states,
  .events,
  .state-row,
  .event-row,
  .state-body,
  .event-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .states,
  .events {
    gap: 0.3rem;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .option-tabs {
    display: flex;
    gap: 0.3rem;
  }

  .option-tab {
    padding: 0.2rem 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
  }

  .option-tab.active {
    color: var(--primary-color);
    border-color: currentColor;
  }

  .option-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.3rem 0 0.3rem 0.6rem;
    border-left: 2px solid var(--border-color);
  }

  .states-head,
  .events-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .add-slot {
    margin-left: auto;
    display: inline-flex;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .state-row,
  .event-row {
    padding: 0.35rem 0;
    border-bottom: 1px dashed var(--border-color);
  }

  .state-name {
    font-weight: 600;
  }

  .event-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .state-body {
    padding: 0.3rem 0 0.4rem 0.6rem;
    border-left: 2px solid var(--border-color);
  }

  .event-body {
    padding: 0.3rem 0 0.3rem 0.6rem;
    border-left: 2px solid var(--border-color);
  }

  .spacer {
    flex: 1 1 auto;
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

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 8rem;
  }

  .duration,
  .is-value {
    width: 6rem;
  }
</style>
