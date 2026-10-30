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
  import { fetchPickerValues } from "$lib/picker-values.svelte.js";
  import { pickerFilters, pickerExpanded } from "$lib/picker-state.svelte.js";
  import { SvelteSet } from "svelte/reactivity";
  import StateTree from "./StateTree.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { enumsOfState, enumLabelFromObject } from "$lib/config/rooms";

  let {
    objects,
    roomsOf,
    rooms,
    enums = undefined,
    selection = new SvelteSet<string>(),
    onToggle = () => {},
    onPick = undefined,
  }: {
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    enums?: any;
    selection?: Set<string>;
    onToggle?: (id: string) => void;
    /** When set, a state is picked with one click instead of ticked. */
    onPick?: (id: string) => void;
  } = $props();

  // Every open starts from the whole tree: a search from the previous open (or
  // a prefilled state id / device name) must not keep the states hidden. The
  // adapter/room/type/role filters stay remembered — only the text is cleared.
  pickerFilters.search = "";

  const allStates = $derived(collectStates(objects));
  const adapters = $derived(
    [...new SvelteSet(allStates.map((s) => adapterOf(s.id)))].sort(),
  );
  const types = $derived(
    [
      ...new SvelteSet(
        allStates.map((s) => String(s.obj?.common?.type ?? "")).filter(Boolean),
      ),
    ].sort(),
  );
  const roles = $derived(
    [
      ...new SvelteSet(
        allStates.map((s) => String(s.obj?.common?.role ?? "")).filter(Boolean),
      ),
    ].sort(),
  );

  const roomOptions = $derived(
    rooms.map((r) => ({ value: r.id, label: r.label, icon: r.icon })),
  );
  const typeOptions = $derived(types.map((t) => ({ value: t, label: t })));
  const roleOptions = $derived(roles.map((r) => ({ value: r, label: r })));
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
  // Build the full tree so every adapter is listed as a root by default; only
  // collapsed branches stay cheap (children render on expand). Variables lead.
  const tree = $derived(
    variableNode
      ? [variableNode, ...buildStateTree(filtered)]
      : buildStateTree(filtered),
  );

  // Fetch values for exactly the visible (expanded) leaves, debounced so typing
  // in the search box does not fire a burst of requests.
  $effect(() => {
    const ids = collectVisibleLeaves(tree, pickerExpanded, 200);
    if (!ids.length) return;
    const t = setTimeout(() => void fetchPickerValues(ids), 150);
    return () => clearTimeout(t);
  });
</script>

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
  <MultiSelect
    options={typeOptions}
    selected={pickerFilters.type}
    placeholder="All types"
    onChange={(v) => (pickerFilters.type = v)}
  />
  <MultiSelect
    options={roleOptions}
    selected={pickerFilters.role}
    placeholder="All roles"
    onChange={(v) => (pickerFilters.role = v)}
  />
</div>

<div class="results">
  {#if filtered.length === 0 && !variableNode}
    <p class="empty text-muted">No matching states.</p>
  {:else}
    <StateTree nodes={tree} {selection} {onToggle} {onPick} {enums} />
  {/if}
</div>

<style>
  .filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr;
    gap: 0.5rem;
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

  @media (max-width: 640px) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
