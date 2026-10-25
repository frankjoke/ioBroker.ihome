<script lang="ts">
  import type { DeviceType, Control } from "$lib/types/device";
  import { newId } from "$lib/utils/ids";
  import {
    collectStates,
    applyFilters,
    buildStateTree,
    buildVariableNode,
    collectVisibleLeaves,
    adapterOf,
  } from "$lib/config/state-tree";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { suggestFeature, roleLabel } from "$lib/config/features";
  import { defaultUnit } from "$lib/config/units";
  import { fetchPickerValues } from "$lib/picker-values.svelte.js";
  import { pickerFilters, pickerExpanded } from "$lib/picker-state.svelte.js";
  import { SvelteSet } from "svelte/reactivity";
  import StateTree from "./StateTree.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";

  let {
    deviceType,
    objects,
    roomsOf,
    rooms,
    enums = undefined,
    mode = "add",
    onAdd,
    onClose,
  }: {
    deviceType: DeviceType;
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    enums?: any;
    /** "replace" points an existing control at another state — one pick only */
    mode?: "add" | "replace";
    onAdd: (controls: Control[]) => void;
    onClose: () => void;
  } = $props();

  // Every open starts from the whole tree: a search from the previous open (or
  // a prefilled state id / device name) must not keep the states hidden. The
  // adapter/room/type/role filters stay remembered — only the text is cleared.
  pickerFilters.search = "";

  const selection = new SvelteSet<string>();

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

  const filtered = $derived(applyFilters(allStates, pickerFilters, roomsOf));
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

  function toggle(id: string) {
    if (mode === "replace") {
      selection.clear();
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
  }

  function add() {
    const variables = new Map(
      (variableNode?.children ?? []).map((node) => [node.id, node]),
    );
    const controls = [...selection].map((id): Control => {
      const variable = variables.get(id);
      const obj = variable?.obj ?? objects.get(id);
      return {
        id: newId(),
        feature: suggestFeature(obj, deviceType) ?? "value",
        stateId: id,
        writable: !!obj?.common?.write,
        // A variable is named as the state it stands for.
        label: variable ? id : roleLabel(obj),
        unit: defaultUnit(obj),
      };
    });
    if (controls.length) onAdd(controls);
  }
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Add states">
  <div class="modal-content">
    <div class="modal-head">
      <h3>{mode === "replace" ? "Change state" : "Add states"}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

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
        <StateTree nodes={tree} {selection} onToggle={toggle} />
      {/if}
    </div>

    <div class="actions">
      <span class="text-muted">{selection.size} selected</span>
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={selection.size === 0}
          onclick={add}
        >
          {#if mode === "replace"}
            Use state
          {:else}
            Add {selection.size || ""}
            {selection.size === 1 ? "control" : "controls"}
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(760px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .filters input,
  .filters select {
    min-width: 0;
    padding: 0.35rem;
  }

  .results {
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

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .actions-buttons {
    display: flex;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .filters {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
