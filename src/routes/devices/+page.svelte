<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    getCanonicalRegistry,
    setCanonicalRegistry,
    devicesEnrichedStore,
  } from "$lib/stores/devices";
  import { newId } from "$lib/utils/ids";
  import { formatAge, formatValue } from "$lib/config/format";
  import { saveRegistry } from "$lib/registry.svelte.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import DeviceForm from "$lib/components/config/DeviceForm.svelte";
  import HistorySummary from "$lib/components/config/HistorySummary.svelte";
  import EnumBadge from "$lib/components/common/EnumBadge.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import {
    roomList,
    roomsOf as roomsOfEnum,
    roomName,
  } from "$lib/config/rooms";
  import { DEVICE_TYPES } from "$lib/config/features";
  import { sortDevices, type SortKey, type SortDir } from "$lib/config/sort";
  import { onMount } from "svelte";
  import {
    peekRequestedLayout,
    requestDeviceConfig,
    takeRequestedDeviceConfig,
  } from "$lib/pages.js";
  import { openSheet } from "$lib/stores/sheet.svelte.js";
  import type { Device, EnrichedControl } from "$lib/types/device";

  let editing = $state<Device | null>(null);
  let showForm = $state(false);
  let roomFilter = $state<string[]>([]);
  let typeFilter = $state<string[]>([]);
  let search = $state("");
  let sortBy = $state<SortKey>("name");
  let sortDir = $state<SortDir>("asc");
  let pendingDelete = $state<Device | null>(null);

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const devices = $derived(getCanonicalRegistry().devices ?? []);
  const rooms = $derived(roomList(ioBroker.enums));

  const enrichedById = $derived(
    new Map($devicesEnrichedStore.map((d) => [d.id, d])),
  );

  function summaries(device: Device): string {
    const controls = (enrichedById.get(device.id)?.controls ??
      device.controls) as EnrichedControl[];
    return (controls ?? [])
      .filter((c) => !c.hidden)
      .map(
        (c) => `${c.label || c.feature}: ${formatValue(c.liveValue, c.unit)}`,
      )
      .join(", ");
  }

  /** Newest `ts` across the device's state-backed controls, or undefined. */
  function lastUpdate(device: Device): number | undefined {
    let latest: number | undefined;
    for (const c of device.controls ?? []) {
      if (!c.stateId) continue;
      const ts = ioBroker.states.get(c.stateId)?.ts;
      if (typeof ts === "number" && (latest === undefined || ts > latest)) {
        latest = ts;
      }
    }
    return latest;
  }

  /** "24m ago" / "just now". */
  function agoLabel(ts: number): string {
    const age = formatAge(ts);
    return age === "now" ? "just now" : `${age} ago`;
  }

  const roomOptions = $derived(
    rooms.map((r) => ({ value: r.id, label: r.label })),
  );
  const typeOptions = DEVICE_TYPES.map((t) => ({ value: t, label: t }));

  const filteredDevices = $derived(
    devices.filter((d) => {
      if (roomFilter.length && !(d.room && roomFilter.includes(d.room)))
        return false;
      if (typeFilter.length && !typeFilter.includes(d.type)) return false;
      if (search && !d.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    }),
  );

  const sortedDevices = $derived(
    sortDevices(filteredDevices, sortBy, sortDir, (d) =>
      roomName(ioBroker.enums, d.room ?? ""),
    ),
  );

  function roomsOf(id: string): string[] {
    return roomsOfEnum(ioBroker.enums, id);
  }

  function commit(next: Device[]) {
    const reg = getCanonicalRegistry();
    setCanonicalRegistry({
      version: (reg.version ?? 0) + 1,
      updatedAt: Date.now(),
      devices: next,
    });
    saveRegistry();
  }

  function addDevice() {
    editing = null;
    showForm = true;
  }

  function editDevice(d: Device) {
    editing = d;
    showForm = true;
  }

  function duplicateDevice(d: Device) {
    const copy = JSON.parse(JSON.stringify(d)) as Device;
    copy.id = newId();
    copy.name = `${d.name} copy`;
    commit([...devices, copy]);
  }

  function deleteDevice(d: Device) {
    pendingDelete = d;
  }

  function confirmDelete() {
    const d = pendingDelete;
    if (d) commit(devices.filter((x) => x.id !== d.id));
    pendingDelete = null;
  }

  // A Ctrl/Cmd+click on a tile lands here with a device to open. The effect
  // waits for the registry, in case the request arrives before it is loaded.
  let requestedId = $state("");
  // A tile editor round trip leaves its tile address pending — offer the way
  // back to that tile (the layout route still takes and clears it).
  let backToTile = $state(false);
  onMount(() => {
    requestedId = takeRequestedDeviceConfig();
    backToTile = peekRequestedLayout() !== null;
  });
  $effect(() => {
    if (!requestedId) return;
    const d = devices.find((x) => x.id === requestedId);
    if (!d) return;
    requestedId = "";
    editDevice(d);
  });

  function onSave(d: Device) {
    const idx = devices.findIndex((x) => x.id === d.id);
    commit(
      idx >= 0 ? devices.map((x) => (x.id === d.id ? d : x)) : [...devices, d],
    );
    showForm = false;
    editing = null;
  }

  function onCancel() {
    showForm = false;
    editing = null;
  }
</script>

<svelte:head>
  <title>Devices - iHome</title>
</svelte:head>

<div class="devices-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>Devices</h1>
    </div>
    <div class="page-actions">
      {#if backToTile}
        <button
          type="button"
          class="btn btn-outline"
          title="Back to the tile editor"
          onclick={() => {
            openSheet();
            // `goto`, not `location.hash = …`: a direct hash edit makes the
            // hash router reload, and the sheet opened just above — module
            // state — would not survive it.
            void goto("#/");
          }}
        >
          <span class="material-symbols-outlined">arrow_back</span>Back to the
          tile
        </button>
      {/if}
      <button
        type="button"
        class="icon-btn primary"
        title="Add device"
        aria-label="Add device"
        disabled={showForm}
        onclick={addDevice}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
  </div>

  {#if showForm}
    <div class="card form-card">
      {#key editing?.id ?? "new"}
        <DeviceForm
          device={editing}
          {objects}
          {roomsOf}
          {rooms}
          {devices}
          {onSave}
          {onCancel}
        />
      {/key}
    </div>
  {/if}

  {#if devices.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No devices yet — add one to get started.</p>
    </div>
  {:else}
    <div class="filter-bar">
      <input type="search" placeholder="Search name…" bind:value={search} />
      <MultiSelect
        options={roomOptions}
        selected={roomFilter}
        enums={ioBroker.enums}
        placeholder="All rooms"
        onChange={(v) => (roomFilter = v)}
      />
      <MultiSelect
        options={typeOptions}
        selected={typeFilter}
        placeholder="All types"
        onChange={(v) => (typeFilter = v)}
      />
      <select bind:value={sortBy} aria-label="Sort by">
        <option value="name">Name</option>
        <option value="room">Room</option>
        <option value="type">Type</option>
      </select>
      <button
        type="button"
        class="sort-dir"
        title="Toggle sort direction"
        aria-label="Toggle sort direction"
        onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
      >
        <span class="material-symbols-outlined"
          >{sortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span
        >
      </button>
    </div>

    {#if filteredDevices.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No devices match the filters.</p>
      </div>
    {/if}

    <div class="device-list">
      {#each sortedDevices as d (d.id)}
        {@const seen = lastUpdate(d)}
        {@const icon = enrichedById.get(d.id)?.objectIcon}
        <div class="card device-row">
          <div class="device-main">
            <span class="device-title">
              {#if icon}
                <Icon value={icon} size={18} />
              {/if}
              <span class="device-name">{d.name}</span>
            </span>
            <span class="device-meta text-muted">
              <span class="badge badge-secondary">{d.type}</span>
              {#if d.room}<EnumBadge id={d.room} enums={ioBroker.enums} />{/if}
              <span class="device-values">{summaries(d)}</span>
              {#if seen !== undefined}
                <span
                  class="device-updated"
                  title={new Date(seen).toLocaleString()}
                >
                  <span class="material-symbols-outlined" aria-hidden="true"
                    >schedule</span
                  >{agoLabel(seen)}</span
                >
              {/if}
            </span>
            {#each (d.controls ?? []).filter((c) => c.history && c.stateId) as c (c.id)}
              <HistorySummary control={c} />
            {/each}
          </div>
          <div class="device-actions">
            <button
              type="button"
              class="icon-btn"
              title="Edit"
              aria-label="Edit"
              onclick={() => editDevice(d)}
            >
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              title="Duplicate"
              aria-label="Duplicate"
              onclick={() => duplicateDevice(d)}
            >
              <span class="material-symbols-outlined">content_copy</span>
            </button>
            <button
              type="button"
              class="icon-btn danger"
              title="Delete"
              aria-label="Delete"
              onclick={() => deleteDevice(d)}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmModal
    title="Delete device"
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  >
    <p>
      Delete <strong>{pendingDelete.name}</strong>
      <span class="text-muted"
        >— {pendingDelete.type}, {pendingDelete.controls?.length ?? 0} control{pendingDelete
          .controls?.length === 1
          ? ""
          : "s"}</span
      >?
    </p>
    <p class="text-muted">This cannot be undone.</p>
  </ConfirmModal>
{/if}

<style>
  .devices-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto auto;
    gap: 0.5rem;
  }

  .filter-bar input,
  .filter-bar select {
    min-width: 0;
    padding: 0.35rem;
  }

  .sort-dir {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .sort-dir:hover {
    background: var(--surface-container);
  }

  .sort-dir .material-symbols-outlined {
    font-size: 18px;
  }

  @media (max-width: 640px) {
    .filter-bar {
      grid-template-columns: 1fr;
    }
  }

  .form-card {
    padding: 1rem;
  }

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .device-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
  }

  .device-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .device-title {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  /* The device's own face (A67): the glyph keeps its size. */
  .device-title :global(img),
  .device-title :global(.material-symbols-outlined) {
    flex: 0 0 auto;
  }

  .device-name {
    font-weight: 600;
  }

  .device-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--body-sm);
    flex-wrap: wrap;
  }

  .device-updated {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .device-updated .material-symbols-outlined {
    font-size: 1em;
  }

  .device-actions {
    display: flex;
    gap: 0.35rem;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--surface-container);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }

  .icon-btn.primary {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--on-primary);
  }

  .icon-btn.primary:hover {
    background: var(--primary-dark);
    border-color: var(--primary-dark);
  }

  .icon-btn.danger:hover {
    background: var(--danger-color, #c0392b);
    border-color: var(--danger-color, #c0392b);
    color: #fff;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }
</style>
