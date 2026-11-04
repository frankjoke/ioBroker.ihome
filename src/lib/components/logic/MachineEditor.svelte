<script lang="ts">
  import type {
    Init,
    LogicDef,
    MachineLogic,
    OnRow,
    Operator,
    StateDef,
  } from "$logic/types";
  import ActionList from "./ActionList.svelte";
  import CodeField from "./CodeField.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { stateIdFor } from "$lib/config/variables";

  let {
    logic,
    logics = [],
    onchange,
  }: {
    logic: MachineLogic;
    /** Every logic in the document: their outputs are event sources (D29). */
    logics?: LogicDef[];
    onchange: (logic: MachineLogic) => void;
  } = $props();

  const stateNames = $derived(Object.keys(logic.states));
  const ROW_IF_PLACEHOLDER = 'get("motion") === true';
  const INIT_STATE_PLACEHOLDER = 'get("mode") === "auto" ? "Auto" : "Manual"';
  /** The other logics, as `$logic.<id>` event sources. */
  const sourceLogics = $derived(
    logics
      .filter((other) => other.id !== logic.id)
      .map((other) => ({ id: other.id, name: other.name || other.id })),
  );
  /** Global state variables: they change, so they are event sources (D30). */
  const globalVariables = $derived(
    getVariables()
      .filter((variable) => variable.kind === "state")
      .map((variable) => ({ name: variable.name, type: variable.type })),
  );
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

  /** The Options strip: what the machine does on start, and the shared rows. */
  const optionTabs = $derived([
    {
      id: "init",
      label: "$init",
      hint: "What the machine does on start: its init state, or the current output value.",
    },
    {
      id: "all",
      label: `$all (${logic.all?.on?.length ?? 0})`,
      hint: "Rows appended after every state's own rows.",
    },
  ]);

  let openOption = $state<"init" | "all" | null>(null);
  /** Nothing disappears from the document without a confirmation. */
  let pendingDelete = $state<
    | { kind: "state"; name: string }
    | { kind: "event"; state: string; index: number }
    | null
  >(null);

  const init = $derived<Init>(logic.init ?? {});

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

  function stateOf(name: string): StateDef {
    return name === "$all" ? (logic.all ?? {}) : (logic.states[name] ?? {});
  }

  function updateState(name: string, state: StateDef) {
    if (name === "$all") {
      patch({ all: { on: state.on ?? [] } });
      return;
    }
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
    if (name === "$all" || stateNames.length <= 1) return;
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
    if (name === "$all") return;
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
    if (oldName === "$all") return;
    const name = rawName.trim();
    if (!name || name.startsWith("$")) return;
    if (name !== oldName && name in logic.states) return;
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
    const state = stateOf(stateName);
    const on = [...(state.on ?? [])];
    on[index] = row;
    updateState(stateName, { ...state, on });
  }

  function removeRow(stateName: string, index: number) {
    const state = stateOf(stateName);
    updateState(stateName, {
      ...state,
      on: (state.on ?? []).filter((_, i) => i !== index),
    });
    if (openRow === index) openRow = null;
  }

  /** Row order is the match order, so the arrows move the row itself. */
  function moveRow(stateName: string, from: number, to: number) {
    const state = stateOf(stateName);
    const on = [...(state.on ?? [])];
    if (to < 0 || to >= on.length) return;
    const [row] = on.splice(from, 1);
    on.splice(to, 0, row);
    updateState(stateName, { ...state, on });
    if (openRow === from) openRow = to;
    else if (openRow === to) openRow = from;
  }

  /** The event's value type, so the condition offers only what fits it (D23). */
  function conditionKind(row: OnRow): "boolean" | "number" | "string" | "any" {
    if (row.on === "$init") return "boolean";
    if (row.on === "$start") return "number";
    if (row.on.startsWith("$var.")) {
      const variable = getVariables().find(
        (item) =>
          item.kind === "state" && item.name === row.on.slice("$var.".length),
      );
      const type = variable?.type;
      return type === "boolean" || type === "number" || type === "string"
        ? type
        : "any";
    }
    if (row.on.startsWith("$logic.")) {
      const source = logics.find(
        (other) => other.id === row.on.slice("$logic.".length),
      );
      if (!source?.output) return "any";
      if (source.output.scope === "memory") {
        return source.kind === "machine" ? "string" : "any";
      }
      return source.output.type ?? "any";
    }
    if (row.on === "$self") {
      const output = logic.output;
      return output && output.scope !== "memory" ? output.type : "any";
    }
    const input = logic.inputs?.[row.on];
    if (!input || input.from.type !== "state") return "any";
    const variables = getVariables();
    for (const ref of [input.from.ref, ...(input.from.refs ?? [])]) {
      if (!ref) continue;
      const type = ioBroker.objects.get(stateIdFor(ref, variables))?.common
        ?.type;
      if (type === "boolean" || type === "number" || type === "string") {
        return type;
      }
    }
    return "any";
  }

  /** The comparisons; on a string they read both sides as numbers. */
  const COMPARE_OPS = [
    { op: "eq", label: "=" },
    { op: "ne", label: "≠" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
  ];
  /** Text conditions compare as glob patterns; `*` matches anything. */
  const TEXT_OPS = [
    { op: "startsWith", label: "starts with" },
    { op: "endsWith", label: "ends with" },
    { op: "includes", label: "includes" },
    { op: "notIncludes", label: "does not include" },
  ];
  function opsFor(kind: "boolean" | "number" | "string" | "any") {
    if (kind === "number") return COMPARE_OPS;
    return [...COMPARE_OPS, ...TEXT_OPS];
  }

  /** A boolean condition is just true / false, not "= true". */
  function setBoolCondition(row: OnRow, raw: string) {
    return raw === ""
      ? undefined
      : { op: "eq" as const, value: raw === "true" };
  }

  function addRow(stateName: string) {
    const state = stateOf(stateName);
    const on = [...(state.on ?? [])];
    on.push({ on: eventInputs[0] ?? "$init", edge: "any" });
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
    return stateOf(state).on?.[index]?.on ?? `event ${index + 1}`;
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

{#snippet eventList(name: string, state: StateDef)}
  <div class="events section-panel">
    <div class="events-head">
      <span class="label-mono">Events ({state.on?.length ?? 0})</span>
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
        <div class="item-line" onclick={(e) => onEventLineClick(e, index)}>
          <span class="event-summary mono">{rowSummary(row)}</span>
          <span class="item-actions">
            <IconButton
              icon="arrow_upward"
              label={`Move event ${index + 1} of ${name} up`}
              title="Move up"
              disabled={index === 0}
              onclick={() => moveRow(name, index, index - 1)}
            />
            <IconButton
              icon="arrow_downward"
              label={`Move event ${index + 1} of ${name} down`}
              title="Move down"
              disabled={index === (state.on?.length ?? 0) - 1}
              onclick={() => moveRow(name, index, index + 1)}
            />
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
          {@const kind = conditionKind(row)}
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
                  <option value="$start">$start (after all logics)</option>
                  <option value="$always">$always (any event)</option>
                  {#each eventInputs as input (input)}
                    <option value={input}>{input}</option>
                  {/each}
                  {#if sourceLogics.length}
                    <optgroup label="Logics">
                      {#each sourceLogics as source (source.id)}
                        <option value={`$logic.${source.id}`}
                          >{source.name}</option
                        >
                      {/each}
                    </optgroup>
                  {/if}
                  {#if globalVariables.length}
                    <optgroup label="Global variables">
                      {#each globalVariables as variable (variable.name)}
                        <option value={`$var.${variable.name}`}
                          >{variable.name}</option
                        >
                      {/each}
                    </optgroup>
                  {/if}
                </select>
              </label>
              <label class="field"
                ><span class="label-mono">Condition</span>
                {#if kind === "boolean"}
                  <select
                    aria-label="Condition"
                    value={row.is ? String(row.is.value === true) : ""}
                    onchange={(e) =>
                      updateRow(name, index, {
                        ...row,
                        is: setBoolCondition(row, e.currentTarget.value),
                      })}
                  >
                    <option value="">*</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                {:else}
                  <select
                    aria-label="Condition"
                    value={row.is?.op ?? ""}
                    onchange={(e) => {
                      const op = e.currentTarget.value;
                      updateRow(name, index, {
                        ...row,
                        is: op
                          ? {
                              op: op as Operator,
                              value: row.is?.value ?? "",
                            }
                          : undefined,
                      });
                    }}
                  >
                    <option value="">*</option>
                    {#each opsFor(kind) as o (o.op)}
                      <option value={o.op}>{o.label}</option>
                    {/each}
                  </select>
                {/if}
              </label>
              {#if row.is && kind !== "boolean"}
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
                          value:
                            kind === "string"
                              ? e.currentTarget.value
                              : parseValue(e.currentTarget.value),
                        },
                      })}
                  />
                </label>
              {/if}
              {#if row.on !== "$always"}
                {#if kind === "boolean"}
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
                      <option value="any">any</option>
                      <option value="change">change</option>
                      <option value="rising">rising</option>
                      <option value="falling">falling</option>
                    </select>
                  </label>
                {:else}
                  <label class="field"
                    ><span class="label-mono">Edge</span>
                    <span class="check"
                      ><input
                        type="checkbox"
                        aria-label="Every update"
                        checked={row.edge === "any"}
                        onchange={(e) =>
                          updateRow(name, index, {
                            ...row,
                            edge: e.currentTarget.checked ? "any" : "change",
                          })}
                      />
                      {row.edge === "any" ? "any" : "change"}</span
                    >
                  </label>
                {/if}
                <label class="field"
                  ><span class="label-mono">Ack</span>
                  <select
                    aria-label="Ack filter"
                    value={row.ack ?? "any"}
                    onchange={(e) =>
                      updateRow(name, index, {
                        ...row,
                        ack: e.currentTarget.value as "any" | "true" | "false",
                      })}
                  >
                    <option value="any">any</option>
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </label>
              {/if}
            </div>

            <div class="block">
              {#if row.if}
                <div class="row">
                  <span class="label-mono">if</span>
                  <CodeField
                    code={row.if.code}
                    {logics}
                    inputs={logic.inputs}
                    label="Row condition"
                    placeholder={ROW_IF_PLACEHOLDER}
                    onchange={(code) =>
                      updateRow(name, index, { ...row, if: { code } })}
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
                      if: { code: "true" },
                    })}>Add condition</button
                >
              {/if}
            </div>

            <div class="block">
              <span class="label-mono">Then</span>
              <ActionList
                actions={row.do ?? []}
                {stateNames}
                {logics}
                inputs={logic.inputs}
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
              <label
                class="check"
                title={row.goto || (row.do ?? []).some((a) => "goto" in a)
                  ? "A goto ends this event — clear it to continue with the next row"
                  : "After this row's actions, keep checking the next rows for the same event"}
              >
                <input
                  type="checkbox"
                  checked={row.continue === true}
                  disabled={!!row.goto ||
                    (row.do ?? []).some((a) => "goto" in a)}
                  onchange={(e) =>
                    updateRow(name, index, {
                      ...row,
                      continue: e.currentTarget.checked || undefined,
                    })}
                />
                <span>continue</span>
              </label>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

<div class="machine">
  <div class="options">
    <div class="states-head">
      <span class="label-mono">Options</span>
    </div>
    <OptionTabs
      bind:value={openOption}
      label="Machine options"
      tabs={optionTabs}
    >
      {#snippet children(id)}
        {#if id === "init"}
          <div class="option-body">
            <p class="hint text-muted">
              Starts in the state whose value matches the current output (a
              boolean's <code>On*</code> or an explicit map); otherwise in the
              first state. Adopting is silent: no enter actions, no timer, no
              output write. Use an init state or a <code>$init</code> row to act.
            </p>
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
                  <CodeField
                    code={init.state.code}
                    {logics}
                    inputs={logic.inputs}
                    label="Init state expression"
                    placeholder={INIT_STATE_PLACEHOLDER}
                    onchange={(code) => patchInit({ state: { code } })}
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
                  patchInit({
                    state: { code: JSON.stringify(stateNames[0] ?? "") },
                  })}>Add init expression</button
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
          <div class="option-body">
            <p class="hint text-muted">
              Rows appended after every state's own rows: a <code>continue</code
              >
              row falls through into them, a terminal state match does not.
            </p>
            {@render eventList("$all", logic.all ?? {})}
          </div>
        {/if}
      {/snippet}
    </OptionTabs>
  </div>

  <div class="states section-panel">
    <div class="states-head">
      <span class="label-mono">States ({stateNames.length})</span>
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
                        {logics}
                        inputs={logic.inputs}
                        onchange={(enter) =>
                          updateState(name, { ...state, enter })}
                      />
                    {:else if id === "exit"}
                      <ActionList
                        actions={state.exit ?? []}
                        {logics}
                        inputs={logic.inputs}
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
                    {/if}
                  </div>
                {/snippet}
              </OptionTabs>
            </div>

            {@render eventList(name, state)}
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

  /* A two-valued edge (change / any) is a tick, not a picker. */
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2rem;
    font-size: var(--body-sm);
  }

  .duration,
  .is-value {
    width: 6rem;
  }
</style>
