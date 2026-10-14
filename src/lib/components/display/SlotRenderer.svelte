<script lang="ts">
  import ControlWidget from "./slots/ControlWidget.svelte";
  import IconSlot from "./slots/IconSlot.svelte";
  import ValueSlot from "./slots/ValueSlot.svelte";
  import type { Slot } from "$lib/types/display";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";

  let {
    slot,
    device,
    control,
    style,
  }: {
    slot: Slot;
    device: EnrichedDevice;
    control?: EnrichedControl;
    style: { icon?: string; color?: string };
  } = $props();

  // Kinds with a control are useless without one; icon/value fall back.
  const needsControl = $derived(
    slot.kind === "level" ||
      slot.kind === "color" ||
      slot.kind === "enum" ||
      slot.kind === "button",
  );
  const show = $derived(!needsControl || !!control);
</script>

{#if show}
  {#if slot.kind === "icon"}
    <IconSlot {slot} {style} fallback={device.icon} />
  {:else if slot.kind === "value"}
    <ValueSlot {slot} {control} />
  {:else if needsControl && control}
    <ControlWidget {control} />
  {/if}
{/if}
