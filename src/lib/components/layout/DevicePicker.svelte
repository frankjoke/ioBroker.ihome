<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import { DEVICE_TYPES } from "$lib/config/features";
  import { enumLabel } from "$lib/config/rooms";
  import type { EnrichedDevice } from "$lib/types/device";

  let {
    devices,
    rooms = [],
    listed = [],
    enums = undefined,
    onAdd,
    onClose,
  }: {
    devices: EnrichedDevice[];
    rooms?: { id: string; label: string; icon?: string }[];
    /** Device ids already in the section: they are not offered again. */
    listed?: string[];
    enums?: any;
    onAdd: (deviceIds: string[]) => void;
    onClose: () => void;
  } = $props();

  let search = $state("");
  let roomFilter = $state<string[]>([]);
  let typeFilter = $state<string[]>([]);
  let functionFilter = $state<string[]>([]);
  const selected = new SvelteSet<string>();

  /** Devices that could still go into this section. */
  const candidates = $derived(devices.filter((d) => !listed.includes(d.id)));

  const functionIds = $derived(
    [...new SvelteSet(candidates.flatMap((d) => d.functions ?? []))].sort(),
  );

  const filtered = $derived(
    candidates.filter(
      (d) =>
        (!search || d.name.toLowerCase().includes(search.toLowerCase())) &&
        (!roomFilter.length || (!!d.room && roomFilter.includes(d.room))) &&
        (!typeFilter.length || typeFilter.includes(d.type)) &&
        (!functionFilter.length ||
          functionFilter.some((f) => (d.functions ?? []).includes(f))),
    ),
  );

  const roomOptions = $derived(
    rooms.map((r) => ({ value: r.id, label: r.label, icon: r.icon })),
  );
  const typeOptions = $derived(
    DEVICE_TYPES.map((t) => ({ value: t as string, label: t })),
  );
  const functionOptions = $derived(
    functionIds.map((f) => ({
      value: f,
      label: enums ? enumLabel(enums, f, "functions") : f,
    })),
  );

  function toggle(id: string): void {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  function addSelected(): void {
    const ids = [...selected];
    if (ids.length) onAdd(ids);
  }

  /** Everything the current filters match — the "add all matching" path. */
  function addFiltered(): void {
    if (filtered.length) onAdd(filtered.map((d) => d.id));
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label="Add devices">
  <div class="modal-content">
    <div class="modal-head">
      <h3>Add devices</h3>
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
      <input type="search" placeholder="Search device…" bind:value={search} />
      <MultiSelect
        options={roomOptions}
        selected={roomFilter}
        {enums}
        placeholder="All rooms"
        onChange={(v) => (roomFilter = v)}
      />
      <MultiSelect
        options={typeOptions}
        selected={typeFilter}
        placeholder="All types"
        onChange={(v) => (typeFilter = v)}
      />
      <MultiSelect
        options={functionOptions}
        selected={functionFilter}
        placeholder="All functions"
        onChange={(v) => (functionFilter = v)}
      />
    </div>

    <div class="results">
      {#if filtered.length === 0}
        <p class="empty text-muted">No matching devices.</p>
      {:else}
        <ul class="device-list">
          {#each filtered as device (device.id)}
            <li>
              <label class="row">
                <input
                  type="checkbox"
                  checked={selected.has(device.id)}
                  onchange={() => toggle(device.id)}
                />
                {#if device.objectIcon}
                  <Icon value={device.objectIcon} size={15} />
                {/if}
                <span class="name">{device.name}</span>
                <span class="meta text-muted"
                  >{device.type}{device.room ? ` · ${device.room}` : ""}</span
                >
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="actions">
      <span class="text-muted">{selected.size} selected</span>
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>Cancel</button>
        <button
          type="button"
          class="btn"
          disabled={filtered.length === 0}
          title="Add every device the filters match"
          onclick={addFiltered}
        >
          Add all {filtered.length || ""} matching
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={selected.size === 0}
          onclick={addSelected}
        >
          Add {selected.size || ""}
          {selected.size === 1 ? "device" : "devices"}
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
    width: min(720px, 100%);
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
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .filters input {
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

  .device-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 2px 4px;
    cursor: pointer;
  }

  /* The device's own face (A67): the glyph keeps its size, the name takes the
     room. */
  .row :global(img),
  .row :global(.material-symbols-outlined) {
    flex: 0 0 auto;
  }

  .row:hover {
    background-color: var(--surface-container);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 0.75rem;
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
