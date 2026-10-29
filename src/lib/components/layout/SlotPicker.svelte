<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList, roomsOf as roomsOfEnum } from "$lib/config/rooms";
  import StateBrowser from "$lib/components/discovery/StateBrowser.svelte";
  import DeviceForm from "$lib/components/config/DeviceForm.svelte";
  import {
    slotFromControl,
    slotFromState,
    slotKindForWidget,
    suggestedSlots,
  } from "$lib/config/slot-create";
  import { resolveTemplate } from "$lib/config/template-ops";
  import { widgetForState } from "$lib/config/slot-source";
  import { getVariables } from "$lib/stores/variables.svelte";
  import type {
    Device,
    EnrichedControl,
    EnrichedDevice,
  } from "$lib/types/device";
  import type { Slot, SlotKind, Template } from "$lib/types/display";

  let {
    devices,
    templates = [],
    title = "Add a slot",
    onAdd,
    onSaveDevice,
    onClose,
  }: {
    devices: EnrichedDevice[];
    templates?: Template[];
    title?: string;
    onAdd: (slots: Slot[]) => void;
    /** Persist a device created here; the picker then selects it. */
    onSaveDevice: (device: Device) => void;
    onClose: () => void;
  } = $props();

  type Tab = "device" | "state" | "page" | "badge";
  const TABS: { id: Tab; label: string }[] = [
    { id: "device", label: "From device" },
    { id: "state", label: "Any state" },
    { id: "page", label: "Web page" },
    { id: "badge", label: "Badge" },
  ];

  let tab = $state<Tab>("device");
  let search = $state("");
  let selectedDeviceId = $state("");
  let selectedControls = new SvelteSet<string>();
  let stateKind = $state<"auto" | SlotKind>("auto");
  let url = $state("");
  let badgeKind = $state<"value" | "ago" | "offline">("value");
  let badgeControlId = $state("");
  /** A badge may read any state, not only a control of the chosen device. */
  let badgeState = $state("");
  let creatingDevice = $state(false);
  /** A device saved in this picker before the store's list caught up. */
  let createdDevice = $state<EnrichedDevice | null>(null);

  const objects = $derived(ioBroker.objects as Map<string, any>);
  const rooms = $derived(roomList(ioBroker.enums));
  const roomsOf = (id: string) => roomsOfEnum(ioBroker.enums, id);

  const filtered = $derived(
    devices.filter(
      (d) =>
        !search ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.type.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const selectedDevice = $derived(
    devices.find((d) => d.id === selectedDeviceId) ??
      (createdDevice?.id === selectedDeviceId ? createdDevice : undefined),
  );
  const controls = $derived(
    (selectedDevice?.controls ?? []).filter((c) => !c.hidden),
  );
  const suggestions = $derived(
    selectedDevice
      ? suggestedSlots(
          selectedDevice,
          resolveTemplate(selectedDevice, templates).slots,
        )
      : [],
  );

  // The first device is the useful default; the list is still one click away.
  $effect(() => {
    if (!selectedDeviceId && devices.length) {
      selectedDeviceId = devices[0].id;
    }
  });

  function toggleControl(id: string): void {
    if (selectedControls.has(id)) selectedControls.delete(id);
    else selectedControls.add(id);
  }

  function addControl(c: EnrichedControl): void {
    if (!selectedDevice) return;
    onAdd([slotFromControl(selectedDevice, c)]);
  }

  function addSelected(): void {
    if (!selectedDevice) return;
    const slots = controls
      .filter((c) => selectedControls.has(c.id))
      .map((c) => slotFromControl(selectedDevice!, c));
    if (slots.length) onAdd(slots);
  }

  function addSuggested(): void {
    if (suggestions.length) onAdd(suggestions);
  }

  /** A tree leaf may be a variable name; its metadata is the real state's
   *  object, while the slot keeps the name (the alias resolves it live). */
  function objectForState(id: string): any {
    const variable = getVariables().find(
      (v) => v.kind === "state" && v.name === id,
    );
    const realId = variable?.stateId ? String(variable.stateId) : id;
    return (
      objects.get(realId) ??
      (variable
        ? {
            common: {
              name: variable.name,
              type: variable.type,
              role: variable.role,
              unit: variable.unit,
              write: false,
            },
          }
        : undefined)
    );
  }

  function pickState(id: string): void {
    const object = objectForState(id);
    const kind =
      stateKind === "auto"
        ? slotKindForWidget(widgetForState(object))
        : stateKind;
    onAdd([slotFromState(id, object, kind)]);
  }

  /** A frame slot (A38): the page it shows is its whole content. */
  function addPage(): void {
    const text = url.trim();
    if (text) onAdd([{ kind: "frame", options: { url: text } }]);
  }

  /** A badge reads a control (value or time since), or the device itself. */
  function addBadge(): void {
    const device = selectedDevice;
    if (!device) return;
    if (badgeKind === "offline") {
      onAdd([{ kind: "badge", source: { kind: "device", device: device.id } }]);
      return;
    }
    const stateId = badgeState.trim();
    if (stateId) {
      const base = slotFromState(stateId, objectForState(stateId), "badge");
      onAdd([
        {
          ...base,
          ...(badgeKind === "ago"
            ? {
                options: { ...(base.options ?? {}), derive: "ago", from: "ts" },
              }
            : {}),
        },
      ]);
      return;
    }
    const control = controls.find((c) => c.id === badgeControlId);
    if (!control) return;
    const base = slotFromControl(device, control);
    onAdd([
      {
        ...base,
        kind: "badge",
        ...(badgeKind === "ago"
          ? { options: { derive: "ago", from: "ts" } }
          : {}),
      },
    ]);
  }

  function saveDevice(d: Device): void {
    onSaveDevice(d);
    createdDevice = d as EnrichedDevice;
    selectedDeviceId = d.id;
    selectedControls.clear();
    creatingDevice = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !creatingDevice) onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <div class="modal-content">
    <div class="modal-head">
      <h3>{title}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="tabs" role="tablist">
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          class="tab"
          class:active={tab === t.id}
          onclick={() => (tab = t.id)}>{t.label}</button
        >
      {/each}
      {#if tab === "state"}
        <label class="kind">
          <span class="label-mono">Kind</span>
          <select
            value={stateKind}
            onchange={(e) =>
              (stateKind = e.currentTarget.value as "auto" | SlotKind)}
          >
            <option value="auto">auto</option>
            <option value="value">value</option>
            <option value="level">level</option>
            <option value="switch">switch</option>
            <option value="color">color</option>
            <option value="enum">enum</option>
            <option value="button">button</option>
          </select>
        </label>
      {/if}
    </div>

    {#if tab === "state"}
      <StateBrowser
        {objects}
        {roomsOf}
        {rooms}
        enums={ioBroker.enums}
        onPick={pickState}
      />
    {:else if tab === "page"}
      <div class="placeholder">
        <div class="row-input">
          <input
            type="text"
            placeholder="http://…/echarts/index.html?preset=…"
            bind:value={url}
          />
          <button
            type="button"
            class="btn btn-primary"
            disabled={!url.trim()}
            onclick={addPage}>Add page</button
          >
        </div>
        <p class="text-muted hint-note">
          The page loads in a frame (A38) — the tile's own space, or the modal's
          wide row, as this slot's destination says.
        </p>
      </div>
    {:else}
      <div class="device-pick">
        <div class="row-input">
          <input
            type="search"
            placeholder="Search device…"
            bind:value={search}
          />
          <button
            type="button"
            class="btn btn-sm"
            onclick={() => (creatingDevice = true)}>New device…</button
          >
        </div>
        <ul class="list device-list">
          {#each filtered as d (d.id)}
            <li>
              <button
                type="button"
                class="row"
                class:picked={selectedDeviceId === d.id}
                onclick={() => {
                  selectedDeviceId = d.id;
                  selectedControls.clear();
                  badgeControlId = "";
                }}
              >
                <span class="name">{d.name || d.id}</span>
                <span class="meta text-muted">{d.type}</span>
              </button>
            </li>
          {/each}
          {#if filtered.length === 0}
            <li class="empty text-muted">No device matches.</li>
          {/if}
        </ul>
      </div>

      {#if selectedDevice && tab === "device"}
        <div class="results">
          {#if controls.length === 0}
            <p class="empty text-muted">
              This device has no controls to offer.
            </p>
          {:else}
            <ul class="list">
              {#each controls as c (c.id)}
                <li>
                  <label class="row">
                    <input
                      type="checkbox"
                      checked={selectedControls.has(c.id)}
                      onchange={() => toggleControl(c.id)}
                    />
                    <span class="name">{c.label || c.feature || c.id}</span>
                    <span class="meta text-muted">{c.stateId || c.id}</span>
                    {#if c.unit}
                      <span class="meta text-muted">{c.unit}</span>
                    {/if}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="actions">
          <span class="text-muted">{selectedControls.size} selected</span>
          <div class="actions-buttons">
            <button
              type="button"
              class="btn"
              disabled={!suggestions.length}
              title={suggestions.length
                ? "Add the slots this device type suggests"
                : "Nothing to suggest for this device"}
              onclick={addSuggested}
            >
              Add suggested{suggestions.length
                ? ` (${suggestions.length})`
                : ""}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={selectedControls.size === 0}
              onclick={addSelected}
            >
              Add {selectedControls.size || ""}
              {selectedControls.size === 1 ? "slot" : "slots"}
            </button>
          </div>
        </div>
      {:else if selectedDevice && tab === "badge"}
        <div class="results">
          <div class="placeholder">
            <div class="row">
              <label class="small">
                <span class="label-mono">Shows</span>
                <select bind:value={badgeKind}>
                  <option value="value">value</option>
                  <option value="ago">time since</option>
                  <option value="offline">device offline</option>
                </select>
              </label>
              {#if badgeKind !== "offline"}
                <label class="small grow">
                  <span class="label-mono">Control</span>
                  <select bind:value={badgeControlId}>
                    <option value="">choose…</option>
                    {#each controls as c (c.id)}
                      <option value={c.id}
                        >{c.label || c.feature || c.id}</option
                      >
                    {/each}
                  </select>
                </label>
                <label class="small grow">
                  <span class="label-mono">or state</span>
                  <input
                    type="text"
                    placeholder="state id or variable"
                    bind:value={badgeState}
                  />
                </label>
              {/if}
            </div>
            <div class="actions">
              <span class="text-muted">
                {badgeKind === "offline"
                  ? "Shown while the device has no reachable state"
                  : badgeKind === "ago"
                    ? "Shown as the time since that control last reported"
                    : "Shown as that control's value in a corner"}
              </span>
              <button
                type="button"
                class="btn btn-primary"
                disabled={badgeKind !== "offline" &&
                  !badgeControlId &&
                  !badgeState.trim()}
                onclick={addBadge}>Add badge</button
              >
            </div>
          </div>
        </div>
      {/if}
    {/if}

    <div class="actions">
      <span class="text-muted">Adds to this tile</span>
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
</div>

{#if creatingDevice}
  <div class="modal" role="dialog" aria-modal="true" aria-label="New device">
    <div class="modal-content device-modal">
      <DeviceForm
        device={null}
        objects={ioBroker.objects}
        {roomsOf}
        {rooms}
        {devices}
        onSave={saveDevice}
        onCancel={() => (creatingDevice = false)}
      />
    </div>
  </div>
{/if}

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
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .device-modal {
    width: min(680px, 100%);
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

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tab {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    cursor: pointer;
  }

  .tab:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .kind select {
    padding: 0.25rem;
  }

  .device-pick {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .device-list {
    max-height: 9rem;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.2rem;
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 9rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background-color: var(--surface-container);
  }

  .row.picked {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
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
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
  }

  .row-input {
    display: flex;
    gap: 0.5rem;
  }

  .row-input input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem;
  }

  .hint-note {
    font-size: 0.75rem;
    margin: 0;
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
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
</style>
