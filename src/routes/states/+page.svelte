<script lang="ts">
  import { onMount } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    getOverrideRegistry,
    initOverrides,
  } from "$lib/stores/overrides.svelte";
  import { patchView, readView } from "$lib/stores/page-view";
  import StateList from "$lib/components/states/StateList.svelte";
  import {
    stateEntries,
    stateMatches,
    type StateFilters,
  } from "$lib/config/state-settings";

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const variables = $derived(getVariables());
  const saved = readView("/states");
  let query = $state("");
  let filters = $state<StateFilters>({});
  let selectedId = $state(saved?.openId ?? "");

  const entries = $derived(
    stateEntries(objects, getOverrideRegistry().overrides, variables),
  );
  const shown = $derived(
    entries.filter((entry) => stateMatches(entry, query, filters)),
  );
  const selected = $derived(objects.get(selectedId));

  $effect(() => {
    if (!selectedId && shown.length) selectedId = shown[0].id;
  });

  function select(id: string): void {
    selectedId = id;
    patchView("/states", { openId: id });
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
        Override, custom metadata and stored history for one state — without
        leaving this page.
      </p>
    </div>
  </header>

  <div class="states-grid">
    <StateList
      entries={shown}
      {selectedId}
      {query}
      {filters}
      onselect={select}
      onquery={(value) => (query = value)}
      onfilters={(value) => (filters = value)}
    />

    <section class="detail card">
      {#if selected}
        <h2>{String(selected.common?.name ?? selectedId)}</h2>
        <p class="mono text-muted">{selectedId}</p>
        <p class="hint text-muted">
          The detail editor is being built in the next task.
        </p>
      {:else}
        <p class="hint text-muted">Select a state on the left.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .states-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 1200px;
    margin: 0 auto;
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

  .detail h2 {
    margin: 0 0 0.25rem;
    font-size: var(--headline-sm);
  }

  @media (max-width: 820px) {
    .states-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
