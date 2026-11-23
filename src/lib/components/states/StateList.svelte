<script lang="ts">
  import type { StateEntry, StateFilters } from "$lib/config/state-settings";

  let {
    entries,
    selectedId,
    query,
    filters,
    onselect,
    onquery,
    onfilters,
  }: {
    entries: StateEntry[];
    selectedId: string;
    query: string;
    filters: StateFilters;
    onselect: (id: string) => void;
    onquery: (value: string) => void;
    onfilters: (value: StateFilters) => void;
  } = $props();

  const count = $derived(entries.length);
</script>

<div class="state-list">
  <div class="list-head">
    <label class="search">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input
        type="search"
        placeholder="Name, id or role…"
        aria-label="Search states"
        value={query}
        oninput={(event) => onquery(event.currentTarget.value)}
      />
    </label>
    <div class="filters">
      <label class="check">
        <input
          type="checkbox"
          checked={filters.override === true}
          onchange={(event) =>
            onfilters({ ...filters, override: event.currentTarget.checked })}
        />
        <span>Override</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={filters.history === true}
          onchange={(event) =>
            onfilters({ ...filters, history: event.currentTarget.checked })}
        />
        <span>History</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={filters.custom === true}
          onchange={(event) =>
            onfilters({ ...filters, custom: event.currentTarget.checked })}
        />
        <span>Custom</span>
      </label>
    </div>
    <span class="hint text-muted">{count} state{count === 1 ? "" : "s"}</span>
  </div>

  <div class="rows">
    {#each entries as entry (entry.id)}
      <button
        type="button"
        class="state-row"
        class:active={entry.id === selectedId}
        onclick={() => onselect(entry.id)}
      >
        <span class="row-main">
          <span class="name">{entry.name}</span>
          <span class="mono id">{entry.id}</span>
        </span>
        <span class="row-meta">
          {#if entry.role}<span class="badge">{entry.role}</span>{/if}
          {#if entry.overrideCount}
            <span class="badge badge-secondary"
              >override {entry.overrideCount}</span
            >
          {/if}
          {#if entry.customKeys.length}
            <span class="badge" title={entry.customKeys.join(", ")}
              >custom {entry.customKeys.length}</span
            >
          {/if}
        </span>
      </button>
    {:else}
      <p class="hint text-muted empty">No states match.</p>
    {/each}
  </div>
</div>

<style>
  .state-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .list-head {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--surface-color);
  }

  .search .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
  }

  .search input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text-color);
    font: inherit;
    outline: none;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    overflow-y: auto;
    min-height: 0;
    max-height: calc(100vh - 15rem);
  }

  .state-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--text-color);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .state-row:hover {
    background: var(--surface-container-low);
  }

  .state-row.active {
    border-color: var(--primary-color);
    background: var(--surface-container-low);
  }

  .row-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .empty {
    padding: 0.5rem;
  }
</style>
