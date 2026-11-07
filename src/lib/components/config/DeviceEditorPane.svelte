<script lang="ts">
  import DeviceForm from "./DeviceForm.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { Device } from "$lib/types/device";

  /**
   * The device editor as one item: its line carries Save (and, when the host
   * passes them, duplicate/delete), its fold-out is the headless form. The same
   * shell the devices page uses, for embed points like the source picker.
   */
  let {
    device,
    objects,
    rooms,
    roomsOf,
    devices = [],
    /** Open the state picker automatically for a new (empty) device. */
    autoPick = true,
    onSave,
    onCancel,
    onDuplicate,
    onDelete,
  }: {
    device: Device | null;
    objects: Map<string, any>;
    rooms: { id: string; label: string; icon?: string }[];
    roomsOf: (id: string) => string[];
    devices?: Device[];
    /** Open the state picker automatically for a new (empty) device. */
    autoPick?: boolean;
    onSave: (d: Device) => void;
    onCancel: () => void;
    onDuplicate?: (d: Device) => void;
    onDelete?: (d: Device) => void;
  } = $props();

  let formEl = $state<{ save: () => void } | undefined>();
  let dirty = $state(false);
</script>

<div class="item open">
  <div class="item-line">
    <span class="name">{device?.name || "New device"}</span>
    <span class="badge badge-secondary">{device?.type ?? "Custom"}</span>
    <span class="item-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!dirty}
        onclick={() => formEl?.save()}>Save</button
      >
      {#if onDuplicate && device}
        <IconButton
          icon="content_copy"
          label={`Duplicate ${device.name}`}
          title="Duplicate"
          onclick={() => onDuplicate?.(device)}
        />
      {/if}
      {#if onDelete && device}
        <IconButton
          icon="delete"
          danger
          label={`Delete ${device.name}`}
          title="Delete"
          onclick={() => onDelete?.(device)}
        />
      {/if}
      <IconButton
        icon="close"
        label="Cancel"
        title="Cancel"
        onclick={onCancel}
      />
    </span>
  </div>
  <div class="item-editor">
    {#key device?.id ?? "new"}
      <DeviceForm
        bind:this={formEl}
        bind:dirty
        {device}
        {objects}
        {rooms}
        {roomsOf}
        {devices}
        {autoPick}
        {onSave}
        {onCancel}
        showHead={false}
      />
    {/key}
  </div>
</div>

<style>
  /* The line is a header here, not a toggle. */
  .item-line {
    cursor: default;
  }
</style>
