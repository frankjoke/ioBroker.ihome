<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    collectStates,
    applyFilters,
    buildStateTree,
    buildVariableNode,
    collectVisibleLeaves,
    adapterOf,
    firstState,
  } from "$lib/config/state-tree";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { fetchPickerValues } from "$lib/picker-values.svelte.js";
  import {
    pickerFilters,
    pickerExpanded,
    rememberPickedState,
    takePickedState,
  } from "$lib/picker-state.svelte.js";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import StateTree from "./StateTree.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import SourceOverrideModal from "$lib/components/overrides/SourceOverrideModal.svelte";
  import { enumsOfState, enumLabelFromObject } from "$lib/config/rooms";
  import { variableMatches, stateIdFor } from "$lib/config/variables";
  import { removeOverride, upsertOverride } from "$lib/config/source-overrides";
  import {
    commitOverrides,
    getOverrideRegistry,
    isOverridesWritable,
  } from "$lib/stores/overrides.svelte";
  import type { SourceOverride } from "$lib/types/overrides";
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
    currentState = "",
    logics = [],
    logicPick = undefined,
    /** Offer the per-state override list and editor (a tile's sources). */
    manageOverrides = false,
  }: {
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    enums?: any;
    selection?: Set<string>;
    onToggle?: (id: string) => void;
    /** When set, a state is picked with one click instead of ticked. */
    onPick?: (id: string, overrideId?: string) => void;
    /** The state this item already uses: the tree opens at it. */
    currentState?: string;
    /** The document's logics, for the Logic tab. */
    logics?: LogicDef[];
    /** What a logic selection means: an event trigger or its output state. */
    logicPick?: "trigger" | "state";
    /** The state rows manage their overrides (add, edit, pick a sub-entry). */
    manageOverrides?: boolean;
  } = $props();

  // Every open starts from the whole tree: a search from the previous open (or
  // a prefilled state id / device name) must not keep the states hidden. The
  // adapter/room/function filters stay remembered — only the text is cleared.
  pickerFilters.search = "";

  let tab = $state<Tab>("states");
  /** The states results box, so a searched/picked line can be scrolled to. */
  let resultsEl = $state<HTMLElement>();
  /** The override sub-lists the user unfolded (keyed by real state id). */
  const expandedOverrides = new SvelteSet<string>();
  /** The override being added (`override` absent) or edited. */
  let overrideForm = $state<{
    stateId: string;
    object: any;
    override?: SourceOverride;
  } | null>(null);
  const canManageOverrides = $derived(manageOverrides && !!onPick);

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
  /** Every override, grouped by the real state id it belongs to. */
  const overridesById = $derived.by(() => {
    const map = new SvelteMap<string, SourceOverride[]>();
    for (const override of getOverrideRegistry().overrides) {
      const id = stateIdFor(override.stateId, getVariables());
      const list = map.get(id) ?? [];
      list.push(override);
      map.set(id, list);
    }
    return map;
  });
  /** Override names/labels per real state id, so a search finds a repair. */
  const overrideNamesById = $derived.by(() => {
    const map = new SvelteMap<string, string[]>();
    for (const [id, list] of overridesById) {
      map.set(
        id,
        list.flatMap((override) => [override.name, override.label ?? ""]),
      );
    }
    return map;
  });
  const filtered = $derived(
    applyFilters(
      allStates,
      pickerFilters,
      roomsOf,
      functionsOf,
      (id) => overrideNamesById.get(id) ?? [],
    ),
  );
  // Global state variables, as the pickable aliases they are: the search box
  // filters them by name, id, the broker state's name and unit, the other
  // filters stay for the broker tree (a variable's adapter is not its own).
  const searchText = $derived((pickerFilters.search ?? "").toLowerCase());
  const variableNode = $derived(
    buildVariableNode(
      getVariables()
        .filter((v) => v.kind === "state" && v.stateId)
        .filter((v) =>
          variableMatches(
            v,
            objects.get(String(v.stateId)),
            pickerFilters.search ?? "",
          ),
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

  function pick(id: string, overrideId?: string) {
    if (onPick) onPick(id, overrideId);
    else onToggle(id);
  }

  /** A one-click tree pick: remember its folder for the next open. A variable
   *  leaf stores the real state so the next open lands in the broker tree. */
  function pickFromTree(id: string, overrideId?: string) {
    const variable = getVariables().find(
      (v) => v.kind === "state" && v.name === id,
    );
    rememberPickedState(variable?.stateId ? String(variable.stateId) : id);
    pick(id, overrideId);
  }

  function overridesFor(stateId: string): SourceOverride[] {
    return overridesById.get(stateId) ?? [];
  }

  function toggleOverrides(id: string) {
    if (expandedOverrides.has(id)) expandedOverrides.delete(id);
    else expandedOverrides.add(id);
  }

  function addOverride(stateId: string, object: any) {
    overrideForm = { stateId, object };
  }

  function editOverride(
    stateId: string,
    object: any,
    override: SourceOverride,
  ) {
    overrideForm = { stateId, object, override };
  }

  /** The picker owns the document write, so the modal stays a form. A failed
   *  save throws: the modal shows the reason and keeps the draft. */
  async function saveOverride(next: SourceOverride): Promise<void> {
    if (!isOverridesWritable()) {
      throw new Error("The override list is not readable — nothing was saved.");
    }
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      upsertOverride(registry, next),
      registry.updatedAt,
    );
    if (result !== "saved") {
      throw new Error(
        result === "conflict"
          ? "The override list changed elsewhere — review and save again."
          : "The override could not be saved (not connected?).",
      );
    }
    overrideForm = null;
    expandedOverrides.add(stateIdFor(next.stateId, getVariables()));
  }

  async function deleteOverride(id: string): Promise<void> {
    if (!isOverridesWritable()) {
      throw new Error(
        "The override list is not readable — nothing was deleted.",
      );
    }
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      removeOverride(registry, id),
      registry.updatedAt,
    );
    if (result !== "saved") {
      throw new Error(
        result === "conflict"
          ? "The override list changed elsewhere — review and delete again."
          : "The override could not be deleted (not connected?).",
      );
    }
    overrideForm = null;
  }

  /** Alias link: reveal the original state whatever filters were set. */
  function goToAlias(base: string) {
    pickerFilters.adapter = "";
    pickerFilters.room = [];
    pickerFilters.functions = [];
    tab = "states";
    pickerFilters.search = base;
  }

  /** Branch ids of a state id, adapter first down to its parent folder. */
  function parentIds(id: string): string[] {
    const parts = id.split(".");
    const out: string[] = [];
    for (let n = 2; n < parts.length; n++)
      out.push(parts.slice(0, n).join("."));
    return out;
  }

  async function scrollTo(selector: string): Promise<boolean> {
    await tick();
    const el = resultsEl?.querySelector(selector);
    el?.scrollIntoView({ block: "center" });
    return !!el;
  }

  // The item's own state wins over the last pick: expand its folder chain and
  // bring its line into view, clearing remembered filters only if they hide it.
  // Otherwise the next pick opens at the last picked state's line.
  onMount(async () => {
    let focus = currentState;
    if (focus) {
      // A variable or logic ref is not a broker state: leave the tree alone.
      if (!allStates.some((s) => s.id === focus)) return;
      if (!filtered.some((s) => s.id === focus)) {
        pickerFilters.adapter = "";
        pickerFilters.room = [];
        pickerFilters.functions = [];
      }
    } else {
      focus = takePickedState();
    }
    if (!focus) return;
    const parents = parentIds(focus);
    for (const id of parents) pickerExpanded.add(id);
    // The item's own state: show its overrides too, not just its line.
    if (overridesFor(focus).length) expandedOverrides.add(focus);
    const found = await scrollTo(`[data-node="state:${focus}"]`);
    const parent = parents[parents.length - 1];
    if (!found && parent) await scrollTo(`[data-branch="${parent}"]`);
  });

  // A search unfolds the chain to its first match and scrolls that line in.
  $effect(() => {
    if (tab !== "states") return;
    if (!(pickerFilters.search ?? "").trim()) return;
    const found = firstState(tree);
    if (!found) return;
    for (const id of found.branches) pickerExpanded.add(id);
    void scrollTo(`[data-node="state:${found.leaf}"]`);
  });

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

  <div class="results" bind:this={resultsEl}>
    {#if filtered.length === 0}
      <p class="empty text-muted">No matching states.</p>
    {:else}
      <StateTree
        nodes={tree}
        {selection}
        {onToggle}
        onPick={onPick ? pickFromTree : undefined}
        {enums}
        {objects}
        onAlias={goToAlias}
        overridesOf={canManageOverrides ? overridesFor : undefined}
        expandedOverrides={canManageOverrides ? expandedOverrides : undefined}
        onToggleOverrides={canManageOverrides ? toggleOverrides : undefined}
        onAddOverride={canManageOverrides ? addOverride : undefined}
        onEditOverride={canManageOverrides ? editOverride : undefined}
      />
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
        onPick={onPick ? pickFromTree : undefined}
        {enums}
        {objects}
        onAlias={goToAlias}
        overridesOf={canManageOverrides ? overridesFor : undefined}
        expandedOverrides={canManageOverrides ? expandedOverrides : undefined}
        onToggleOverrides={canManageOverrides ? toggleOverrides : undefined}
        onAddOverride={canManageOverrides ? addOverride : undefined}
        onEditOverride={canManageOverrides ? editOverride : undefined}
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

{#if overrideForm}
  <SourceOverrideModal
    stateId={overrideForm.stateId}
    object={overrideForm.object}
    override={overrideForm.override}
    existingNames={overridesFor(overrideForm.stateId).map((o) => o.name)}
    onSave={saveOverride}
    onDelete={deleteOverride}
    onClose={() => (overrideForm = null)}
  />
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
    font-family: var(--font-family);
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
