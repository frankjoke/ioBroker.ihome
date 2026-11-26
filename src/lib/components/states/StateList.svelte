<script lang="ts">
  import { tick } from "svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import SelectField from "$lib/components/common/SelectField.svelte";
  import {
    stateDepth,
    type StateEntry,
    type StateFilters,
  } from "$lib/config/state-settings";

  let {
    entries,
    selectedId,
    instances,
    instance,
    query,
    filters,
    roleOptions,
    roomOptions,
    functionOptions,
    onselect,
    oninstance,
    onquery,
    onfilters,
    oncontext,
  }: {
    entries: StateEntry[];
    selectedId: string;
    instances: string[];
    instance: string;
    query: string;
    filters: StateFilters;
    roleOptions: { value: string; label: string }[];
    roomOptions: { value: string; label: string }[];
    functionOptions: { value: string; label: string }[];
    onselect: (id: string) => void;
    oninstance: (value: string) => void;
    onquery: (value: string) => void;
    onfilters: (value: StateFilters) => void;
    oncontext?: (entry: StateEntry, event: MouseEvent) => void;
  } = $props();

  const count = $derived(entries.length);
  const instanceOptions = $derived([
    { value: "", label: "--all--" },
    ...instances.map((name) => ({ value: name, label: name })),
  ]);
  let rowsEl = $state<HTMLDivElement>();
  let scrolledFor = "";

  $effect(() => {
    if (!rowsEl || !selectedId || selectedId === scrolledFor) return;
    scrolledFor = selectedId;
    void tick().then(() => {
      const row = rowsEl?.querySelector<HTMLElement>(".state-row.active");
      if (!row || !rowsEl) return;
      const list = rowsEl.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      if (box.top < list.top) rowsEl.scrollTop -= list.top - box.top;
      else if (box.bottom > list.bottom) {
        rowsEl.scrollTop += box.bottom - list.bottom;
      }
    });
  });
</script>

<div class="state-list">
  <div class="list-head">
    <div class="select-row">
      <label class="instance">
        <span class="label-mono">Instance</span>
        <SelectField
          value={instance}
          options={instanceOptions}
          onchange={oninstance}
          label="Instance"
        />
      </label>
      <label>
        <span class="label-mono">Function</span>
        <SelectField
          value={filters.function ?? ""}
          options={functionOptions}
          onchange={(fn) => onfilters({ ...filters, function: fn })}
          label="Filter by function"
        />
      </label>
    </div>
    <div class="filter-selects">
      <label>
        <span class="label-mono">Role</span>
        <SelectField
          value={filters.role ?? ""}
          options={roleOptions}
          onchange={(role) => onfilters({ ...filters, role })}
          label="Filter by role"
        />
      </label>
      <label>
        <span class="label-mono">Room</span>
        <SelectField
          value={filters.room ?? ""}
          options={roomOptions}
          onchange={(room) => onfilters({ ...filters, room })}
          label="Filter by room"
        />
      </label>
    </div>
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
    </div>
    <span class="hint text-muted">{count} state{count === 1 ? "" : "s"}</span>
  </div>

  <div class="rows" bind:this={rowsEl}>
    {#each entries as entry (entry.id)}
      {@const depth = stateDepth(entry.id)}
      <button
        type="button"
        class="state-row"
        class:active={entry.id === selectedId}
        style={`--state-depth:${depth};--state-icon-space:${
          entry.icon ? "1.05rem" : "0rem"
        }`}
        title="Right-click for state actions"
        onclick={() => onselect(entry.id)}
        oncontextmenu={(event) => {
          if (!oncontext) return;
          event.preventDefault();
          event.stopPropagation();
          oncontext(entry, event);
        }}
      >
        <span class="row-main">
          <span class="mono id" title={entry.id}
            ><span dir="ltr">{entry.id}</span></span
          >
          <span class="name-line">
            {#if entry.icon}
              <span class="state-icon" title={entry.icon.from}>
                <Icon
                  value={entry.icon.value}
                  owner={entry.icon.from}
                  size={14}
                />
              </span>
            {/if}
            <span class="name">{entry.name}</span>
          </span>
        </span>
        <span class="row-meta">
          {#if entry.type}<span class="badge badge-secondary">{entry.type}</span
            >{/if}
          {#if entry.role}<span class="badge">{entry.role}</span>{/if}
          {#if entry.overrideCount}
            <span class="badge badge-secondary"
              >override {entry.overrideCount}</span
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
    height: 100%;
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

  .instance,
  .select-row label,
  .filter-selects label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .instance {
    max-width: 10rem;
  }

  .select-row {
    display: grid;
    grid-template-columns: 10rem minmax(0, 1fr);
    gap: 0.35rem;
    align-items: end;
  }

  .filter-selects {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem;
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
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.2rem;
    overflow-y: auto;
    min-height: 0;
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

  .name-line {
    display: flex;
    align-items: center;
    min-width: 0;
    padding-left: calc(max(0, var(--state-depth, 1) - 2) * 0.9rem);
  }

  .row-meta {
    padding-left: calc(
      max(0, var(--state-depth, 1) - 2) * 0.9rem +
        var(--state-icon-space, 1.05rem)
    );
  }

  .state-icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0.9rem;
    height: 0.9rem;
    margin-right: 0.15rem;
    color: var(--text-muted);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--body-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id {
    font-weight: 500;
    color: var(--text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* The tail (SET/ACTUAL, the state name) is the distinguishing part; clip
       the shared prefix instead. */
    direction: rtl;
    text-align: left;
  }

  .id > span {
    direction: ltr;
  }

  .row-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .empty {
    padding: 0.5rem;
  }

  @media (max-width: 820px) {
    .state-list {
      height: auto;
    }

    .rows {
      overflow: visible;
    }
  }
</style>
