<script lang="ts">
  import {
    collectStates,
    applyFilters,
    buildStateTree,
    buildVariableNode,
    collectVisibleLeaves,
    adapterOf,
  } from "$lib/config/state-tree";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { fetchPickerValues } from "$lib/picker-values.svelte.js";
  import { pickerFilters, pickerExpanded } from "$lib/picker-state.svelte.js";
  import { SvelteSet } from "svelte/reactivity";
  import StateTree from "./StateTree.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { enumsOfState, enumLabelFromObject } from "$lib/config/rooms";
  import type { LogicDef } from "$logic/types";

  type Tab = "states" | "variables" | "logic";

  let {
    objects,
    roomsOf,
    rooms,
    enums = undefined,
    selection = new SvelteSet<string>(),
    onToggle = () => {},
    onPick = undefined,
    logics = [],
    logicPick = undefined,
  }: {
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    enums?: any;
    selection?: Set<string>;
    onToggle?: (id: string) => void;
    /** When set, a state is picked with one click instead of ticked. */
    onPick?: (id: string) => void;
    /** The document's logics, for the Logic tab. */
    logics?: LogicDef[];
    /** What a logic selection means: an event trigger or its output state. */
    logicPick?: "trigger" | "state";
  } = $props();

  // Every open starts from the whole tree: a search from the previous open (or
  // a prefilled state id / device name) must not keep the states hidden. The
  // adapter/room/function filters stay remembered — only the text is cleared.
  pickerFilters.search = "";

  let tab = $state<Tab>("states");

  const allStates = $derived(collectStates(objects));
  const adapters = $derived(
    [...new SvelteSet(allStates.map((s) => adapterOf(s.id)))].sort(),
  );
  const roomOptions = $derived(
    rooms.map((r) => ({ value: r.id, label: r.label, icon: r.icon })),
  );
  const functionOptions = $derived(
    (enums?.getList?.("functions") ?? []).map((e: any) => ({
      value: e._id,
      label: enumLabelFromObject(e),
    })),
  );

  const functionsOf = (id: string) => enumsOfState(enums, id, "functions");
  const filtered = $derived(
    applyFilters(allStates, pickerFilters, roomsOf, functionsOf),
  );
  // Global state variables, as the pickable aliases they are: the search box
  // filters them by name or by the real state id, the other filters stay for
  // the broker tree (a variable's adapter is not its own).
  const searchText = $derived((pickerFilters.search ?? "").toLowerCase());
  const variableNode = $derived(
    buildVariableNode(
      getVariables()
        .filter((v) => v.kind === "state" && v.stateId)
        .filter(
          (v) =>
            !searchText ||
            v.name.toLowerCase().includes(searchText) ||
            String(v.stateId).toLowerCase().includes(searchText),
        ),
      objects,
    ),
  );
  const tree = $derived(buildStateTree(filtered));

  /** Logic outputs: a trigger for events, the output state for a value. */
  const logicRows = $derived.by(() => {
    if (!logicPick) return [];
    return logics
      .filter(
        (logic) =>
          !searchText ||
          logic.id.toLowerCase().includes(searchText) ||
          logic.name.toLowerCase().includes(searchText),
      )
      .map((logic) => {
        let ref: string | undefined;
        if (logicPick === "trigger") ref = `$logic.${logic.id}`;
        else if (logic.output?.scope === "state") ref = logic.output.ref;
        else if (logic.output?.scope === "logic" && ioBroker.namespace) {
          ref = `${ioBroker.namespace}.Logic.${logic.id}`;
        }
        return ref ? { id: logic.id, name: logic.name || logic.id, ref } : null;
      })
      .filter((row): row is { id: string; name: string; ref: string } => !!row);
  });

  function pick(id: string) {
    if (onPick) onPick(id);
    else onToggle(id);
  }

  // Fetch values for exactly the visible (expanded) leaves, debounced so typing
  // in the search box does not fire a burst of requests.
  $effect(() => {
    if (tab !== "states") return;
    const ids = collectVisibleLeaves(tree, pickerExpanded, 200);
    if (!ids.length) return;
    const t = setTimeout(() => void fetchPickerValues(ids), 150);
    return () => clearTimeout(t);
  });
</script>

<div class="tabs" role="tablist" aria-label="Pick from">
  <button
    type="button"
    role="tab"
    class="tab"
    class:active={tab === "states"}
    aria-selected={tab === "states"}
    onclick={() => (tab = "states")}>States</button
  >
  <button
    type="button"
    role="tab"
    class="tab"
    class:active={tab === "variables"}
    aria-selected={tab === "variables"}
    onclick={() => (tab = "variables")}>Variables</button
  >
  {#if logicPick}
    <button
      type="button"
      role="tab"
      class="tab"
      class:active={tab === "logic"}
      aria-selected={tab === "logic"}
      onclick={() => (tab = "logic")}>Logic</button
    >
  {/if}
</div>

{#if tab === "states"}
  <div class="filters">
    <input
      type="search"
      placeholder="Search id or name…"
      bind:value={pickerFilters.search}
    />
    <select bind:value={pickerFilters.adapter}>
      <option value="">All adapters</option>
      {#each adapters as a (a)}
        <option value={a}>{a}</option>
      {/each}
    </select>
    <MultiSelect
      options={roomOptions}
      selected={pickerFilters.room}
      {enums}
      placeholder="All rooms"
      onChange={(v) => (pickerFilters.room = v)}
    />
    <MultiSelect
      options={functionOptions}
      selected={pickerFilters.functions}
      {enums}
      placeholder="All functions"
      onChange={(v) => (pickerFilters.functions = v)}
    />
  </div>

  <div class="results">
    {#if filtered.length === 0}
      <p class="empty text-muted">No matching states.</p>
    {:else}
      <StateTree nodes={tree} {selection} {onToggle} {onPick} {enums} />
    {/if}
  </div>
{:else if tab === "variables"}
  <div class="filters simple">
    <input
      type="search"
      placeholder="Search variables…"
      bind:value={pickerFilters.search}
    />
  </div>
  <div class="results">
    {#if !variableNode}
      <p class="empty text-muted">No state variables.</p>
    {:else}
      <StateTree
        nodes={variableNode.children ?? []}
        {selection}
        {onToggle}
        {onPick}
        {enums}
      />
    {/if}
  </div>
{:else}
  <div class="filters simple">
    <input
      type="search"
      placeholder="Search logics…"
      bind:value={pickerFilters.search}
    />
  </div>
  <div class="results">
    {#if logicRows.length === 0}
      <p class="empty text-muted">No logic output to pick.</p>
    {:else}
      <ul class="logic-list">
        {#each logicRows as row (row.id)}
          <li>
            <button
              type="button"
              class="logic-row"
              title={row.ref}
              onclick={() => pick(row.ref)}
            >
              <span class="logic-name">{row.name}</span>
              <span class="logic-ref">{row.ref}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .tab {
    padding: 0.3rem 0.7rem;
    border: none;
    border-radius: 0 0 0 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .tab:hover {
    color: var(--text-color);
  }

  .tab.active {
    color: var(--primary-color);
    box-shadow: inset 0 -2px 0 var(--primary-color);
  }

  .filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .filters.simple {
    grid-template-columns: 1fr;
  }

  .filters input,
  .filters select {
    min-width: 0;
    padding: 0.35rem;
  }

  .results {
    flex: 1 1 auto;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .logic-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .logic-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    padding: 0.2rem 0.35rem;
    border: none;
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .logic-row:hover {
    background: var(--surface-container);
  }

  .logic-name {
    font-weight: 600;
  }

  .logic-ref {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
