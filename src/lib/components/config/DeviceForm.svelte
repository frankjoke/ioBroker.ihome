<script lang="ts">
  import type { Control, Device, DeviceType } from "$lib/types/device";
  import { untrack } from "svelte";
  import ControlRow from "./ControlRow.svelte";
  import StatePicker from "$lib/components/discovery/StatePicker.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { projectDevice } from "$lib/config/project";
  import {
    suggestDeviceType,
    suggestDeviceName,
    DEVICE_TYPES,
  } from "$lib/config/features";
  import { ancestorObjects, parentName } from "$lib/config/state-tree";
  import { roomForState, roomName, enumLabel } from "$lib/config/rooms";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let {
    device = null,
    objects,
    roomsOf,
    rooms,
    devices = [],
    onSave,
    onCancel,
  }: {
    device?: Device | null;
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    devices?: Device[];
    onSave: (d: Device) => void;
    onCancel: () => void;
  } = $props();

  const init = untrack(() =>
    device ? (JSON.parse(JSON.stringify(device)) as Device) : null,
  );

  let name = $state(init?.name ?? "");
  let type = $state<DeviceType>(init?.type ?? "Custom");
  let room = $state(init?.room ?? "");
  let section = $state(init?.section ?? "");
  let panel = $state(init?.panel ?? "");
  let icon = $state(init?.icon ?? "");
  let controls = $state<Control[]>(init?.controls ?? []);
  // auto-open the picker for a brand-new (empty) device
  let showPicker = $state(untrack(() => !device));

  // room options as badges; keep a legacy/unknown room so it isn't dropped
  const roomOptions = $derived(
    room && !rooms.some((r) => r.id === room)
      ? [
          ...rooms.map((r) => ({ value: r.id, label: r.label })),
          { value: room, label: enumLabel(ioBroker.enums, room) },
        ]
      : rooms.map((r) => ({ value: r.id, label: r.label })),
  );

  function addStates(newControls: Control[]) {
    const wasEmpty = controls.length === 0;
    controls = [...controls, ...newControls];

    // auto-fill the device room from the first added state that resolves one
    if (!room) {
      for (const c of newControls) {
        const r = roomForState(ioBroker.enums, c.stateId);
        if (r) {
          room = r;
          break;
        }
      }
    }

    if (wasEmpty && newControls.length) {
      const stateId = newControls[0].stateId;
      // derive the device type from the first state (role, or a parent folder's role)
      if (type === "Custom") {
        type = suggestDeviceType(
          objects.get(stateId),
          ancestorObjects(objects, stateId),
        );
      }
      // default name: Room.Type (.Superstate when a same-type device is in the room)
      if (!name.trim()) {
        const duplicate = devices.some(
          (d) => d.type === type && d.room === room,
        );
        name = suggestDeviceName(
          type,
          roomName(ioBroker.enums, room),
          parentName(objects, stateId),
          duplicate,
        );
      }
    }

    showPicker = false;
  }

  function updateControl(i: number, c: Control) {
    controls = controls.map((x, j) => (j === i ? c : x));
  }

  function removeControl(i: number) {
    controls = controls.filter((_, j) => j !== i);
  }

  function save() {
    onSave(
      projectDevice({
        id: device?.id ?? crypto.randomUUID(),
        name: name.trim() || "Device",
        type,
        room: room || undefined,
        section: section || undefined,
        panel: panel || undefined,
        icon: icon || undefined,
        controls,
      }),
    );
  }
</script>

<div class="device-form">
  <div class="form-head">
    <h3>{device ? "Edit device" : "Add device"}</h3>
    <button
      type="button"
      class="icon-btn"
      title="Cancel"
      aria-label="Cancel"
      onclick={onCancel}
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>

  <div class="fields">
    <label class="field"
      ><span class="label-mono">Name</span>
      <input type="text" bind:value={name} /></label
    >
    <label class="field"
      ><span class="label-mono">Type</span>
      <select bind:value={type}>
        {#each DEVICE_TYPES as t (t)}
          <option value={t}>{t}</option>
        {/each}
      </select></label
    >
    <label class="field"
      ><span class="label-mono">Room</span>
      <MultiSelect
        options={roomOptions}
        selected={room ? [room] : []}
        enums={ioBroker.enums}
        multiple={false}
        placeholder="— none —"
        onChange={(v) => (room = v[0] ?? "")}
      /></label
    >
    <label class="field"
      ><span class="label-mono">Section</span>
      <input type="text" bind:value={section} /></label
    >
    <label class="field"
      ><span class="label-mono">Panel</span>
      <input type="text" bind:value={panel} /></label
    >
    <label class="field"
      ><span class="label-mono">Icon</span>
      <input
        type="text"
        placeholder="e.g. lightbulb"
        bind:value={icon}
      /></label
    >
  </div>

  <div class="controls">
    <div class="controls-head">
      <h4>Controls</h4>
      <button
        type="button"
        class="icon-btn"
        title="Add state"
        aria-label="Add state"
        onclick={() => (showPicker = true)}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
    {#if controls.length === 0}
      <p class="text-muted">No controls yet — add a state.</p>
    {/if}
    {#each controls as control, i (control.id)}
      <ControlRow
        {control}
        deviceType={type}
        onChange={(c) => updateControl(i, c)}
        onRemove={() => removeControl(i)}
      />
    {/each}
  </div>

  <div class="actions">
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={save}>Save</button>
  </div>
</div>

{#if showPicker}
  <StatePicker
    deviceType={type}
    {objects}
    {roomsOf}
    {rooms}
    enums={ioBroker.enums}
    initialSearch={device ? "" : name}
    onAdd={addStates}
    onClose={() => (showPicker = false)}
  />
{/if}

<style>
  .device-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .device-form h3,
  .controls-head h4 {
    margin: 0;
  }

  .form-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
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

  .fields {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .controls-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .fields {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
