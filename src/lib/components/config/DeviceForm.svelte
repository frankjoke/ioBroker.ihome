<script lang="ts">
  import type { Control, Device, DeviceType } from "$lib/types/device";
  import { newId } from "$lib/utils/ids";
  import { untrack } from "svelte";
  import ControlRow from "./ControlRow.svelte";
  import StatePicker from "$lib/components/discovery/StatePicker.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { projectDevice } from "$lib/config/project";
  import { ancestorObjects, parentName } from "$lib/config/state-tree";
  import { applyPickedState } from "$lib/config/control-ops";
  import {
    roleLabel,
    suggestDeviceType,
    suggestDeviceName,
    DEVICE_TYPES,
  } from "$lib/config/features";
  import { defaultUnit } from "$lib/config/units";
  import { roomForState, roomName, enumLabel } from "$lib/config/rooms";
  import { stateIdFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let {
    device = null,
    objects,
    roomsOf,
    rooms,
    devices = [],
    showHead = true,
    onSave,
    onCancel,
  }: {
    device?: Device | null;
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    devices?: Device[];
    showHead?: boolean;
    onSave: (d: Device) => void;
    onCancel: () => void;
  } = $props();

  const init = untrack(() =>
    device ? (JSON.parse(JSON.stringify(device)) as Device) : null,
  );

  let name = $state(init?.name ?? "");
  // Optional display name for the tile: the display drops a trailing ".Type"
  // from the device name, and this overrides whatever is left.
  let title = $state(init?.title ?? "");
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
    // A control may name a variable; its real state answers the room and type
    // questions (the picker stores the bare name on purpose).
    const variables = getVariables();
    const realId = (id: string | undefined) => stateIdFor(id ?? "", variables);

    // auto-fill the device room from the first added state that resolves one
    if (!room) {
      for (const c of newControls) {
        const r = roomForState(ioBroker.enums, realId(c.stateId));
        if (r) {
          room = r;
          break;
        }
      }
    }

    if (wasEmpty && newControls.length) {
      const stateId = realId(newControls[0].stateId);
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

  let autoOpenId = $state<string | null>(null);
  // index of the row whose state is being changed; null while adding new ones
  let replaceIndex = $state<number | null>(null);

  function replaceState(picked: Control | undefined) {
    if (replaceIndex === null || !picked) return;
    const i = replaceIndex;
    const row = controls[i];
    const previous = objects.get(stateIdFor(row.stateId ?? "", getVariables()));
    replaceIndex = null;
    updateControl(
      i,
      applyPickedState(row, picked, {
        label: roleLabel(previous),
        unit: defaultUnit(previous),
      }),
    );
  }

  function addVirtual() {
    const id = newId();
    controls = [
      ...controls,
      {
        id,
        kind: "virtual",
        feature: "value",
        writable: false,
        label: "",
        virtual: { expr: "" },
      },
    ];
    autoOpenId = id;
  }

  function save() {
    // This form edits the legacy fields only. The display fields (template,
    // size, slots, watch, tags, functions, favorites) and each control's rules
    // belong to the page/template editors, so they are carried over untouched —
    // an edit here must never delete them.
    const before = device?.controls ?? [];
    const controlsWithRules = controls.map((c) => {
      const prev = before.find((k) => k.id === c.id);
      return prev?.rules ? { ...c, rules: prev.rules } : c;
    });
    onSave(
      projectDevice({
        id: device?.id ?? newId(),
        name: name.trim() || "Device",
        title: title.trim() || undefined,
        type,
        room: room || undefined,
        section: section || undefined,
        panel: panel || undefined,
        icon: icon || undefined,
        functions: device?.functions,
        favorites: device?.favorites,
        tags: device?.tags,
        template: device?.template,
        size: device?.size,
        slots: device?.slots,
        watch: device?.watch,
        controls: controlsWithRules,
      }),
    );
  }
</script>

<div class="device-form">
  {#if showHead}
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
  {/if}

  <div class="fields">
    <label class="field"
      ><span class="label-mono">Name</span>
      <input type="text" bind:value={name} /></label
    >
    <label class="field"
      ><span class="label-mono">Tile title</span>
      <input
        type="text"
        bind:value={title}
        placeholder="defaults to the name"
      /></label
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
  </div>

  <div class="controls">
    <div class="controls-head">
      <h4>Controls</h4>
      <div class="head-actions">
        <button
          type="button"
          class="icon-btn"
          title="Add virtual state"
          aria-label="Add virtual state"
          onclick={addVirtual}
        >
          <span class="material-symbols-outlined">functions</span>
        </button>
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
    </div>
    {#if controls.length === 0}
      <p class="text-muted">No controls yet — add a state.</p>
    {/if}
    {#each controls as control, i (control.id)}
      <ControlRow
        {control}
        siblings={controls}
        autoOpen={control.id === autoOpenId}
        onChange={(c) => updateControl(i, c)}
        onChangeState={() => (replaceIndex = i)}
        onRemove={() => removeControl(i)}
      />
    {/each}
  </div>

  <div class="actions">
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={save}>Save</button>
  </div>
</div>

{#if showPicker || replaceIndex !== null}
  <StatePicker
    deviceType={type}
    {objects}
    {roomsOf}
    {rooms}
    enums={ioBroker.enums}
    mode={replaceIndex !== null ? "replace" : "add"}
    onAdd={(picked) =>
      replaceIndex !== null ? replaceState(picked[0]) : addStates(picked)}
    onClose={() => {
      showPicker = false;
      replaceIndex = null;
    }}
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
    grid-template-columns: 1fr 1fr;
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

  .head-actions {
    display: flex;
    gap: 0.35rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
