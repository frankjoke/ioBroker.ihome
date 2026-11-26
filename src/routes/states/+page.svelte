<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    getOverrideRegistry,
    initOverrides,
  } from "$lib/stores/overrides.svelte";
  import { patchView, readView } from "$lib/stores/page-view";
  import { takeRequestedStateConfig } from "$lib/pages.js";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import StateList from "$lib/components/states/StateList.svelte";
  import StateDetail from "$lib/components/states/StateDetail.svelte";
  import StateCreateModal from "$lib/components/states/StateCreateModal.svelte";
  import VariablesPanel from "$lib/components/variables/VariablesPanel.svelte";
  import {
    isSystemInstance,
    keptInstance,
    restoreSelection,
    stateEntries,
    stateMatches,
    stateRoles,
    type StateFilters,
  } from "$lib/config/state-settings";
  import { enumShortId, functionList, roomList } from "$lib/config/rooms";
  import {
    STATES_TABS,
    resolveStatesTab,
    type StatesTab,
  } from "$lib/config/states-tabs";
  import { STATES_GUIDE, VARIABLES_GUIDE } from "$lib/config/page-guides";

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const variables = $derived(getVariables());
  const saved = readView("/states");

  /** The app is hash-routed; the tab query lives inside the hash. */
  function hashQuery(): URLSearchParams {
    const hash = page.url.hash;
    return new URLSearchParams(
      hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "",
    );
  }

  const requestedTab =
    page.url.searchParams.get("tab") ?? hashQuery().get("tab");
  const initialTab = resolveStatesTab(requestedTab, saved?.tab);
  let tab = $state<StatesTab>(initialTab);
  let tabValue = $state<StatesTab | null>(initialTab);
  const restoreId = takeRequestedStateConfig() || saved?.openId || "";
  let restored = false;
  let query = $state(saved?.query ?? "");
  const savedFilters = saved?.filters ?? {};
  let filters = $state<StateFilters>({
    override: savedFilters.override === true,
    history: savedFilters.history === true,
    role: typeof savedFilters.role === "string" ? savedFilters.role : "",
    room: typeof savedFilters.room === "string" ? savedFilters.room : "",
    function:
      typeof savedFilters.function === "string" ? savedFilters.function : "",
  });
  let instance = $state(saved?.instance ?? "");
  let selectedId = $state("");
  let creating = $state(false);
  let sortDir = $state<"asc" | "desc">("asc");
  let variablesOpen = $state(false);
  let variablesPanel = $state<{
    startAdd: (kind: "state" | "constant") => void;
  } | null>(null);

  const entries = $derived(
    stateEntries(
      objects,
      getOverrideRegistry().overrides,
      variables,
      ioBroker.enums,
    ).filter((entry) => !isSystemInstance(entry.instance)),
  );
  const instances = $derived(
    [...new Set(entries.map((entry) => entry.instance))].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  const shown = $derived(
    entries.filter((entry) =>
      stateMatches(entry, query, { ...filters, instance }),
    ),
  );
  const selected = $derived(objects.get(selectedId));

  const roleOptions = $derived([
    { value: "", label: "All roles" },
    ...stateRoles(objects, filters.role ?? "").map((role) => ({
      value: role,
      label: role,
    })),
  ]);
  const roomOptions = $derived(
    withCurrent(
      [
        { value: "", label: "All rooms" },
        ...roomList(ioBroker.enums).map((room) => ({
          value: room.id,
          label: room.label,
        })),
      ],
      filters.room ?? "",
      "Room",
    ),
  );
  const functionOptions = $derived(
    withCurrent(
      [
        { value: "", label: "All functions" },
        ...functionList(ioBroker.enums).map((fn) => ({
          value: fn.id,
          label: fn.label,
        })),
      ],
      filters.function ?? "",
      "Function",
    ),
  );

  function withCurrent(
    options: { value: string; label: string }[],
    value: string,
    label: string,
  ) {
    if (value && !options.some((option) => option.value === value)) {
      options.push({ value, label: `${label} ${enumShortId(value)}` });
    }
    return options;
  }

  function changeTab(next: StatesTab | null): void {
    const target = next ?? "states";
    tab = target;
    tabValue = target;
    patchView("/states", { tab: target });
    history.replaceState(history.state, "", `#/states?tab=${target}`);
  }

  function select(id: string): void {
    selectedId = id;
    patchView("/states", { openId: id });
  }

  function openState(id: string): void {
    changeTab("states");
    select(id);
  }

  function deletedState(id: string): void {
    const next = shown.find((entry) => entry.id !== id);
    selectedId = next?.id ?? "";
    patchView("/states", { openId: next?.id ?? null });
  }

  function setInstance(value: string): void {
    instance = value;
    const next = entries.filter((entry) =>
      stateMatches(entry, query, { ...filters, instance: value }),
    );
    if (next.length && !next.some((entry) => entry.id === selectedId)) {
      select(next[0].id);
    }
  }

  function created(id: string): void {
    creating = false;
    instance = "";
    query = "";
    filters = {};
    select(id);
    void ioBroker.getObject(id, true).catch(() => undefined);
  }

  // A view remembered in the previous run can name an instance that is gone;
  // the select would show --all-- while the filter still hid every state.
  $effect(() => {
    const next = keptInstance(instance, instances);
    if (next !== instance) instance = next;
  });

  $effect(() => {
    if (restored || entries.length === 0) return;
    restored = true;
    const id = restoreSelection(entries, restoreId);
    if (id) select(id);
  });

  // A remembered tab (or a programmatic change) must also appear in the URL,
  // so a refresh and a copied link keep the same tab.
  $effect(() => {
    if (hashQuery().get("tab") === tab) return;
    history.replaceState(history.state, "", `#/states?tab=${tab}`);
  });

  $effect(() => {
    patchView("/states", {
      query,
      instance,
      filters: {
        override: filters.override === true,
        history: filters.history === true,
        role: filters.role ?? "",
        room: filters.room ?? "",
        function: filters.function ?? "",
      },
    });
  });

  onMount(() => {
    void initOverrides().catch(() => undefined);
  });
</script>

<svelte:head>
  <title>States - iHome</title>
</svelte:head>

<div class="states-page">
  <div class="item">
    <div class="item-line title-line">
      <div class="tabs-line">
        <OptionTabs
          bind:value={tabValue}
          label="States, variables and constants"
          tabs={STATES_TABS}
          collapsible={false}
          showHint={false}
          onchange={changeTab}
        />
      </div>
      <div class="page-actions">
        {#if tab === "states"}
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            onclick={() => (creating = true)}
          >
            + State
          </button>
        {:else if tab === "variables"}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            title="Sort by name"
            aria-label={`Sort by name ${sortDir === "asc" ? "descending" : "ascending"}`}
            onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
          >
            Sort {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            disabled={variablesOpen}
            onclick={() => variablesPanel?.startAdd("state")}
          >
            + Variable
          </button>
        {:else if tab === "constants"}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            title="Sort by name"
            aria-label={`Sort by name ${sortDir === "asc" ? "descending" : "ascending"}`}
            onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
          >
            Sort {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            disabled={variablesOpen}
            onclick={() => variablesPanel?.startAdd("constant")}
          >
            + Constant
          </button>
        {/if}
      </div>
    </div>
    {#if tab === "help"}
      <div class="item-editor">
        <HelpSection help={STATES_GUIDE} static plain />
        <HelpSection help={VARIABLES_GUIDE} static plain />
      </div>
    {/if}
  </div>

  <div class="tab-panel" hidden={tab !== "states"}>
    <div class="states-grid">
      <StateList
        entries={shown}
        {selectedId}
        {instances}
        {instance}
        {query}
        {filters}
        {roleOptions}
        {roomOptions}
        {functionOptions}
        onselect={select}
        oninstance={setInstance}
        onquery={(value) => (query = value)}
        onfilters={(value) => (filters = value)}
      />

      <section class="detail card">
        {#if selected}
          <StateDetail
            id={selectedId}
            object={selected}
            {variables}
            ondelete={deletedState}
          />
        {:else}
          <p class="hint text-muted">Select a state on the left.</p>
        {/if}
      </section>
    </div>
  </div>

  <div class="tab-panel" hidden={tab !== "variables" && tab !== "constants"}>
    <VariablesPanel
      bind:this={variablesPanel}
      bind:hasOpenEditor={variablesOpen}
      kind={tab === "constants" ? "constant" : "state"}
      {sortDir}
      onopenstate={openState}
    />
  </div>
</div>

{#if creating}
  <StateCreateModal oncreated={created} onclose={() => (creating = false)} />
{/if}

<style>
  .states-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .title-line {
    cursor: default;
  }

  .tabs-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .page-actions .add-action {
    min-width: 7rem;
    justify-content: center;
  }

  .states-grid {
    display: grid;
    grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  .detail {
    padding: 1rem;
    min-height: 12rem;
    min-width: 0;
  }

  @media (max-width: 820px) {
    .states-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
