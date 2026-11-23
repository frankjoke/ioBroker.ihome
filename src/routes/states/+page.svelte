<script lang="ts">
  import { onMount } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    getOverrideRegistry,
    initOverrides,
  } from "$lib/stores/overrides.svelte";
  import { patchView, readView } from "$lib/stores/page-view";
  import { takeRequestedStateConfig } from "$lib/pages.js";
  import StateList from "$lib/components/states/StateList.svelte";
  import StateDetail from "$lib/components/states/StateDetail.svelte";
  import StateCreateModal from "$lib/components/states/StateCreateModal.svelte";
  import {
    restoreSelection,
    stateEntries,
    stateMatches,
    type StateFilters,
  } from "$lib/config/state-settings";

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const variables = $derived(getVariables());
  const saved = readView("/states");
  const restoreId = takeRequestedStateConfig() || saved?.openId || "";
  let restored = false;
  let query = $state("");
  let filters = $state<StateFilters>({});
  let instance = $state("");
  let selectedId = $state("");
  let creating = $state(false);

  const entries = $derived(
    stateEntries(objects, getOverrideRegistry().overrides, variables),
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

  $effect(() => {
    if (restored || entries.length === 0) return;
    restored = true;
    const id = restoreSelection(entries, restoreId);
    if (id) select(id);
  });

  function select(id: string): void {
    selectedId = id;
    patchView("/states", { openId: id });
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

  onMount(() => {
    void initOverrides().catch(() => undefined);
  });
</script>

<svelte:head>
  <title>States - iHome</title>
</svelte:head>

<div class="states-page">
  <header class="page-head">
    <div>
      <h1>States</h1>
      <p class="hint text-muted">
        Override, state settings and stored history for one state — without
        leaving this page.
      </p>
    </div>
    <button
      type="button"
      class="btn btn-primary btn-sm"
      onclick={() => (creating = true)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
      New state
    </button>
  </header>

  <div class="states-grid">
    <StateList
      entries={shown}
      {selectedId}
      {instances}
      {instance}
      {query}
      {filters}
      onselect={select}
      oninstance={setInstance}
      onquery={(value) => (query = value)}
      onfilters={(value) => (filters = value)}
    />

    <section class="detail card">
      {#if selected}
        <StateDetail id={selectedId} object={selected} {variables} />
      {:else}
        <p class="hint text-muted">Select a state on the left.</p>
      {/if}
    </section>
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

  .page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .page-head h1 {
    margin: 0;
    font-size: var(--headline-md);
  }

  .page-head .hint {
    margin: 0.25rem 0 0;
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
