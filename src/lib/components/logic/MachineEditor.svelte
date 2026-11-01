<script lang="ts">
  import type { Expr, Init, MachineLogic, OnRow, StateDef } from "$logic/types";
  import ActionList from "./ActionList.svelte";
  import ExprEditor from "./ExprEditor.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";

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
  /** The state's options tab: enter, exit or the timeout. */
  let stateTab = $state<"enter" | "exit" | "timeout" | null>("enter");
  /** The Options tab: $init today, $all and more later. */
  /** The state's own blocks, always one open. */
  const STATE_TABS = [
    {
      id: "enter",
      label: "Enter",
      hint: "What runs when the machine enters this state.",
    },
    {
      id: "exit",
      label: "Exit",
      hint: "What runs when the machine leaves this state.",
    },
    {
      id: "timeout",
      label: "Timeout",
      hint: "What happens if the state stays active too long.",
    },
  ] as const;

  /** The Options strip: what the machine does on start, and the future shared rows. */
  const OPTION_TABS = [
    {
      id: "init",
      label: "$init",
      hint: "What the machine does on start: its init state, or the current output value.",
    },
    {
      id: "all",
      label: "$all",
      hint: "Rows that would run for every state — not editable yet.",
    },
  ] as const;

  let openOption = $state<"init" | "all" | null>(null);
  /** Nothing disappears from the document without a confirmation. */
  let pendingDelete = $state<
    | { kind: "state"; name: string }
    | { kind: "event"; state: string; index: number }
    | null
  >(null);

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

  function onEventLineClick(event: MouseEvent, index: number) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    openRow = openRow === index ? null : index;
  }

  function toggleState(name: string) {
    openState = openState === name ? null : name;
    openRow = null;
    stateTab = "enter";
  }

  /** The whole state line opens it, except its actions and controls. */
  function onLineClick(event: MouseEvent, name: string) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    toggleState(name);
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

  /** Reordering changes the index a number output writes, so it is a first
   *  class action. The current start state is pinned first, otherwise moving a
   *  state to the top would silently make it the start. */
  function moveState(name: string, delta: number) {
    const from = stateNames.indexOf(name);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= stateNames.length) return;
    const start = logic.start ?? stateNames[0];
    const entries = Object.entries(logic.states);
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    const states: Record<string, StateDef> = {};
    for (const [key, value] of entries) states[key] = value;
    patch({ states, start });
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

  function eventName(state: string, index: number): string {
    return logic.states[state]?.on?.[index]?.on ?? `event ${index + 1}`;
  }

  function rowSummary(row: OnRow): string {
    const parts = [`on ${row.on}`];
    if (row.is) {
      const value =
        row.is.value === undefined ? "" : ` ${String(row.is.value)}`;
      parts.push(`${row.is.op}${value}`);
    }
    if (row.edge && row.edge !== "change") parts.push(row.edge);
    if (row.source && row.source !== "external")
      parts.push(`source ${row.source}`);
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
    <OptionTabs
      bind:value={openOption}
      label="Machine options"
      tabs={OPTION_TABS}
    >
      {#snippet children(id)}
        {#if id === "init"}
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
              <span class="hint text-muted">
                Needs an external output state.
              </span>
            {/if}
            {#if init.state !== undefined}
              <div class="row">
                <span class="label-mono">init state</span>
                {#if typeof init.state === "string"}
                  <input
                    aria-label="Init state name"
                    value={init.state}
                    onchange={(e) =>
                      patchInit({ state: e.currentTarget.value })}
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
                onclick={() =>
                  patchInit({ state: { const: stateNames[0] ?? "" } })}
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
        {:else if id === "all"}
          <p class="hint text-muted">
            Common rows and actions for every state — the editor follows with
            the input/usage redesign.
          </p>
        {/if}
      {/snippet}
    </OptionTabs>
  </div>

  <div class="states section-panel">
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
      {@const stateOpen = openState === name}
      <div class="item" class:open={stateOpen}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(e) => onLineClick(e, name)}>
          {#if stateOpen}
            <input
              class="name-input"
              value={name}
              aria-label={`Name for ${name}`}
              onchange={(e) => renameState(name, e.currentTarget.value)}
            />
          {:else}
            <button
              type="button"
              class="name"
              onclick={() => toggleState(name)}
            >
              {name}
            </button>
          {/if}
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
          <span class="item-actions">
            <IconButton
              icon="arrow_upward"
              label={`Move ${name} up`}
              title="Move up"
              disabled={stateNames.indexOf(name) === 0}
              onclick={() => moveState(name, -1)}
            />
            <IconButton
              icon="arrow_downward"
              label={`Move ${name} down`}
              title="Move down"
              disabled={stateNames.indexOf(name) === stateNames.length - 1}
              onclick={() => moveState(name, 1)}
            />
            <IconButton
              icon="delete"
              danger
              label={`Delete ${name}`}
              title="Delete"
              disabled={stateNames.length <= 1}
              onclick={() => (pendingDelete = { kind: "state", name })}
            />
          </span>
        </div>

        {#if stateOpen}
          <div class="item-editor">
            <div class="state-options">
              <OptionTabs
                bind:value={stateTab}
                label="State options"
                tabs={STATE_TABS}
                collapsible={false}
              >
                {#snippet children(id)}
                  <div class="option-body">
                    {#if id === "enter"}
                      <ActionList
                        actions={state.enter ?? []}
                        onchange={(enter) =>
                          updateState(name, { ...state, enter })}
                      />
                    {:else if id === "exit"}
                      <ActionList
                        actions={state.exit ?? []}
                        onchange={(exit) =>
                          updateState(name, { ...state, exit })}
                      />
                    {:else}
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
                                  ? {
                                      ...state.after,
                                      goto: e.currentTarget.value,
                                    }
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
                    {/if}
                  </div>
                {/snippet}
              </OptionTabs>
            </div>

            <div class="events section-panel">
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
                {@const eventOpen = openRow === index}
                <div class="item" class:open={eventOpen}>
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="item-line"
                    onclick={(e) => onEventLineClick(e, index)}
                  >
                    <span class="event-summary mono">{rowSummary(row)}</span>
                    <span class="item-actions">
                      <IconButton
                        icon="delete"
                        danger
                        label={`Delete event ${index + 1} of ${name}`}
                        title="Delete"
                        onclick={() =>
                          (pendingDelete = {
                            kind: "event",
                            state: name,
                            index,
                          })}
                      />
                    </span>
                  </div>

                  {#if eventOpen}
                    <div class="item-editor">
                      <div class="row event-options">
                        <label class="field"
                          ><span class="label-mono">On</span>
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
                            <option value="$self">$self (target state)</option>
                            {#each eventInputs as input (input)}
                              <option value={input}>{input}</option>
                            {/each}
                          </select>
                        </label>
                        <label class="field"
                          ><span class="label-mono">Condition</span>
                          <select
                            aria-label="Condition"
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
                            <option value="">*</option>
                            <option value="eq">=</option>
                            <option value="ne">≠</option>
                            <option value="gt">&gt;</option>
                            <option value="gte">≥</option>
                            <option value="lt">&lt;</option>
                            <option value="lte">≤</option>
                          </select>
                        </label>
                        {#if row.is}
                          <label class="field"
                            ><span class="label-mono">Value</span>
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
                          </label>
                        {/if}
                        <label class="field"
                          ><span class="label-mono">Edge</span>
                          <select
                            aria-label="Edge"
                            value={row.edge ?? "change"}
                            onchange={(e) =>
                              updateRow(name, index, {
                                ...row,
                                edge: e.currentTarget.value as
                                  "change" | "rising" | "falling" | "any",
                              })}
                          >
                            <option value="change">change</option>
                            <option value="rising">rising</option>
                            <option value="falling">falling</option>
                            <option value="any">any</option>
                          </select>
                        </label>
                        <label class="field"
                          ><span class="label-mono">Ack</span>
                          <select
                            aria-label="Ack filter"
                            value={row.ack ?? "any"}
                            onchange={(e) =>
                              updateRow(name, index, {
                                ...row,
                                ack: e.currentTarget.value as
                                  "any" | "true" | "false",
                              })}
                          >
                            <option value="any">any</option>
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </label>
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

{#if pendingDelete}
  <ConfirmModal
    title={pendingDelete.kind === "state"
      ? deleteTitle("state", pendingDelete.name, {
          kind: "logic",
          name: logic.name,
        })
      : deleteTitle(
          "event",
          eventName(pendingDelete.state, pendingDelete.index),
          {
            kind: "state",
            name: pendingDelete.state,
          },
        )}
    confirmLabel="Delete"
    onConfirm={() => {
      if (pendingDelete?.kind === "state") removeState(pendingDelete.name);
      else if (pendingDelete?.kind === "event") {
        removeRow(pendingDelete.state, pendingDelete.index);
      }
      pendingDelete = null;
    }}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

<style>
  .machine,
  .states,
  .events {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .events {
    gap: 0.25rem;
  }

  .states {
    gap: 0.25rem;
  }

  .options {
    --option-tab-bg: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
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

  .event-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .event-options {
    align-items: flex-end;
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
