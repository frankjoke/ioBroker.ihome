<script lang="ts">
  import ControlWidget from "./slots/ControlWidget.svelte";
  import IconSlot from "./slots/IconSlot.svelte";
  import ValueSlot from "./slots/ValueSlot.svelte";
  import SparklineSlot from "./slots/SparklineSlot.svelte";
  import HistoryListSlot from "./slots/HistoryListSlot.svelte";
  import FrameSlot from "./slots/FrameSlot.svelte";
  import type { Slot } from "$lib/types/display";
  import type {
    EnrichedControl,
    EnrichedDevice,
    SlotControl,
  } from "$lib/types/device";

  let {
    slot,
    device,
    control,
    style,
    onPrimary,
    emphasis,
  }: {
    slot: Slot;
    device: EnrichedDevice;
    control?: SlotControl;
    style: { icon?: string; color?: string; disabled?: boolean };
    onPrimary?: () => void;
    emphasis?: "primary" | "secondary";
  } = $props();

  // Kinds with a control are useless without one; icon/value fall back.
  const needsControl = $derived(
    slot.kind === "level" ||
      slot.kind === "color" ||
      slot.kind === "enum" ||
      slot.kind === "button" ||
      slot.kind === "sparkline" ||
      slot.kind === "history-list",
  );
  const show = $derived(!needsControl || !!control);
</script>

<!-- The control-bearing kinds below only open up for a control that resolved
     from the device (a raw-state pseudo-control reaches value/icon kinds only),
     so the cast to the full enriched shape is safe. -->
{#if show}
  {#if slot.kind === "icon"}
    <IconSlot {slot} {style} fallback={device.icon} {onPrimary} />
  {:else if slot.kind === "value"}
    <ValueSlot {slot} {control} {onPrimary} {emphasis} />
  {:else if slot.kind === "sparkline" && control}
    <SparklineSlot
      control={control as EnrichedControl}
      stretch={slot.options?.background === true}
    />
  {:else if slot.kind === "history-list" && control}
    <HistoryListSlot
      control={control as EnrichedControl}
      count={Number(slot.options?.count ?? 4)}
    />
  {:else if slot.kind === "frame"}
    <FrameSlot {slot} />
  {:else if needsControl && control}
    <ControlWidget control={control as EnrichedControl} />
  {/if}
{/if}
