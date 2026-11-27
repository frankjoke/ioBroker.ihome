<script lang="ts">
  import type { Input, InputSource, LogicDef, TimerSpec } from "$logic/types";
  import { onMount } from "svelte";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { stateIdFor, variableNameFor } from "$lib/config/variables";
  import { formatValue } from "$lib/config/format";
  import {
    fetchPickerValues,
    getPickerValue,
  } from "$lib/picker-values.svelte.js";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import MultiStateField from "./MultiStateField.svelte";
  import TimerModal from "./TimerModal.svelte";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import { timerInputName, timerLabel } from "$logic/timer-ops";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList, roomsOf as roomsOfEnum } from "$lib/config/rooms";

  let {
    inputs,
    onchange,
    onRename,
    where = "",
    logics = [],
    selfId = "",
    /** The row whose fields are open; the parent binds it to close it when the
     *  code field takes focus. */
    editing = $bindable(null),
  }: {
    inputs: Record<string, Input>;
    onchange: (inputs: Record<string, Input>) => void;
    /** Rewrites every reference when the parent can (preferred). */
    onRename?: (oldName: string, newName: string) => void;
    /** The logic name, for the delete confirmation's "from …". */
    where?: string;
    /** Every logic: its output can be a source of a local event. */
    logics?: LogicDef[];
    /** The logic being edited, excluded from its own event sources. */
    selfId?: string;
    editing?: string | null;
  } = $props();

  /** Deleting an input always asks first. */
  let pendingDelete = $state<string | null>(null);
  /** The event whose + State opens the picker. */
  let sourceFor = $state<string | null>(null);
  /** The timer input whose schedule is being edited. */
  let timerEdit = $state<string | null>(null);
  /** The timer dialog for a brand-new timer input. */
  let addingTimer = $state(false);
  const rooms = $derived(roomList(ioBroker.enums));
  const roomsOf = (id: string) => roomsOfEnum(ioBroker.enums, id);
  const otherLogics = $derived(logics.filter((logic) => logic.id !== selfId));

  function update(name: string, input: Input) {
    onchange({ ...inputs, [name]: input });
  }

  /** + State on an event line: add the picked state/logic to its source list. */
  function addSource(name: string, id: string) {
    const input = inputs[name];
    if (!input) return;
    const state =
      input.from.type === "state"
        ? input.from
        : { type: "state" as const, ref: "", refs: [] };
    const refs = [state.ref, ...(state.refs ?? [])].filter(Boolean);
    if (!refs.includes(id)) refs.push(id);
    const timers =
      input.from.type === "timer"
        ? [input.from.every, ...(input.timers ?? [])]
        : input.timers;
    update(name, {
      ...input,
      from: { type: "state", ref: refs[0] ?? "", refs: refs.slice(1) },
      ...(timers?.length ? { timers } : {}),
    });
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

  function toggle(name: string) {
    editing = editing === name ? null : name;
  }

  /** The whole line opens the row, except its actions and controls. */
  function onLineClick(event: MouseEvent, name: string) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    toggle(name);
  }

  function uniqueName(base: string): string {
    let index = Object.keys(inputs).length + 1;
    let name = `${base}${index}`;
    while (name in inputs) name = `${base}${++index}`;
    return name;
  }

  /** The timer's own name when free, otherwise the first free numbered one. */
  function uniqueNameFrom(base: string): string {
    if (!(base in inputs)) return base;
    let index = 2;
    let name = `${base}${index}`;
    while (name in inputs) name = `${base}${++index}`;
    return name;
  }

  /** A state collection: one name, one or more states/patterns. */
  function addVariable() {
    const name = uniqueName("variable");
    onchange({
      ...inputs,
      [name]: { from: { type: "state", ref: "", refs: [] }, kind: "event" },
    });
    editing = name;
  }

  function timerInput(spec: TimerSpec): InputSource {
    return typeof spec === "string"
      ? { type: "timer", every: spec }
      : { type: "timer", spec };
  }

  /** Saving the timer dialog for a new or an existing timer input. */
  function saveTimerInput(name: string, spec: TimerSpec) {
    const input = inputs[name];
    if (!input) return;
    update(name, { ...input, from: timerInput(spec) });
  }

  function sourceLabel(input: Input): string {
    if (input.from.type === "state") {
      const variables = getVariables();
      const states = [input.from.ref, ...(input.from.refs ?? [])]
        .filter(Boolean)
        .map((ref) => {
          if (!ref.startsWith("$logic."))
            return variableNameFor(ref, variables);
          const sourceId = ref.slice("$logic.".length);
          return logics.find((source) => source.id === sourceId)?.name ?? ref;
        });
      const timers = (input.timers ?? []).map((timer) => timerLabel(timer));
      const all = [...states, ...timers];
      if (all.length === 0) return "(no source)";
      return all.length === 1 ? all[0] : `${all[0]} +${all.length - 1}`;
    }
    if (input.from.type === "memory")
      return input.from.ref || "(no memory name)";
    const spec = input.from.spec ?? input.from.every;
    return spec ? timerLabel(spec) : "(no schedule)";
  }

  /** The first source's current reading, like the state picker shows it. */
  function sourceReading(input: Input): string {
    if (input.from.type !== "state" || !input.from.ref) return "";
    return liveReading(input.from.ref);
  }

  /** The current value and unit of a state ref, empty until it is fetched. */
  function liveReading(ref: string): string {
    const id = ref.startsWith("$logic.")
      ? `${ioBroker.namespace}.Logic.${ref.slice("$logic.".length)}`
      : stateIdFor(ref, getVariables());
    const reading = getPickerValue(id);
    if (!reading) return "";
    const common = ioBroker.objects.get(id)?.common;
    return formatValue(reading.val, common?.unit, common?.role);
  }

  /** The source states the line readings need, as broker ids. */
  function sourceStateIds(): string[] {
    const variables = getVariables();
    const ids: string[] = [];
    for (const input of Object.values(inputs)) {
      if (input.from.type !== "state") continue;
      for (const ref of [input.from.ref, ...(input.from.refs ?? [])]) {
        if (!ref) continue;
        ids.push(
          ref.startsWith("$logic.")
            ? `${ioBroker.namespace}.Logic.${ref.slice("$logic.".length)}`
            : stateIdFor(ref, variables),
        );
      }
    }
    return ids;
  }

  onMount(() => {
    const tick = () => void fetchPickerValues(sourceStateIds());
    tick();
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  });
</script>

<div class="inputs section-panel">
  <div class="inputs-head">
    <span class="label-mono">Local variables &amp; events</span>
    <span class="add-slot">
      <button type="button" class="btn btn-sm" onclick={addVariable}>
        <span class="material-symbols-outlined">add</span> Variable
      </button>
      <button
        type="button"
        class="btn btn-sm"
        onclick={() => (addingTimer = true)}
      >
        <span class="material-symbols-outlined">add</span> Timer
      </button>
    </span>
  </div>

  {#each Object.entries(inputs) as [name, input] (name)}
    {@const open = editing === name}
    <div class="item" class:open>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, name)}>
        {#if open}
          <input
            class="name-input"
            value={name}
            aria-label={`Name for ${name}`}
            onchange={(e) => rename(name, e.currentTarget.value)}
          />
        {:else}
          <button type="button" class="name" onclick={() => toggle(name)}>
            {name}
          </button>
        {/if}
        <span class="input-source mono text-muted">{sourceLabel(input)}</span>
        {#if sourceReading(input)}
          <span class="input-reading mono">{sourceReading(input)}</span>
        {/if}
        <span class="item-actions">
          {#if input.from.type === "state"}
            <button
              type="button"
              class="btn btn-sm"
              title="Add a state, logic or pattern source"
              onclick={() => (sourceFor = name)}>+ State</button
            >
          {/if}
          <IconButton
            icon="delete"
            danger
            label={`Delete ${name}`}
            title="Delete"
            onclick={() => (pendingDelete = name)}
          />
        </span>
      </div>
      {#if open}
        <div class="item-editor">
          <div class="fields">
            {#if input.from.type === "state"}
              <div class="field wide">
                <span class="label-mono">Sources</span>
                <MultiStateField
                  value={[input.from.ref, ...(input.from.refs ?? [])].filter(
                    Boolean,
                  )}
                  label={`Sources for ${name}`}
                  {logics}
                  {selfId}
                  hideAdd
                  timers={input.timers ?? []}
                  onTimers={(timers) =>
                    update(name, {
                      ...input,
                      timers: timers.length ? timers : undefined,
                    })}
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
                <label class="field"
                  ><span class="label-mono">or pattern</span>
                  <input
                    class="mono"
                    aria-label={`Pattern for ${name}`}
                    placeholder="alias.0.Gang.*.motion"
                    onchange={(e) => {
                      const pattern = e.currentTarget.value.trim();
                      if (!pattern) return;
                      e.currentTarget.value = "";
                      addSource(name, pattern);
                    }}
                  />
                </label>
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
                      from: {
                        type: "memory",
                        ref: e.currentTarget.value.trim(),
                      },
                    })}
                />
              </label>
            {:else}
              <div class="field wide">
                <span class="label-mono">Schedule</span>
                <div class="row">
                  <span class="mono">{sourceLabel(input)}</span>
                  <button
                    type="button"
                    class="btn btn-sm"
                    onclick={() => (timerEdit = name)}>Edit</button
                  >
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}

  {#if Object.keys(inputs).length === 0}
    <p class="hint text-muted">No local inputs yet — use the buttons above.</p>
  {/if}
</div>

{#if sourceFor}
  <SourcePicker
    mode="state"
    title={`Add a source to ${sourceFor}`}
    logics={otherLogics}
    logicPick="trigger"
    onState={(id) => {
      addSource(sourceFor!, id);
      sourceFor = null;
    }}
    onClose={() => (sourceFor = null)}
  />
{/if}

{#if addingTimer}
  <TimerModal
    onSave={(timer) => {
      const name = uniqueNameFrom(timerInputName(timer));
      onchange({
        ...inputs,
        [name]: { from: timerInput(timer), kind: "event" },
      });
      editing = name;
      addingTimer = false;
    }}
    onCancel={() => (addingTimer = false)}
  />
{/if}

{#if timerEdit}
  <TimerModal
    timer={(() => {
      const from = inputs[timerEdit]?.from;
      return from?.type === "timer" ? (from.spec ?? from.every ?? null) : null;
    })()}
    onSave={(timer) => {
      if (timerEdit) saveTimerInput(timerEdit, timer);
      timerEdit = null;
    }}
    onCancel={() => (timerEdit = null)}
  />
{/if}

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
    gap: 0.25rem;
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

  .input-source {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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

  .field input {
    width: 100%;
  }
</style>
