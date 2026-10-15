<script lang="ts">
  import ControlWidget from "./slots/ControlWidget.svelte";
  import IconSlot from "./slots/IconSlot.svelte";
  import ValueSlot from "./slots/ValueSlot.svelte";
  import SparklineSlot from "./slots/SparklineSlot.svelte";
  import HistoryListSlot from "./slots/HistoryListSlot.svelte";
  import type { Slot } from "$lib/types/display";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";

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
    control?: EnrichedControl;
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

{#if show}
  {#if slot.kind === "icon"}
    <IconSlot {slot} {style} fallback={device.icon} {onPrimary} />
  {:else if slot.kind === "value"}
    <ValueSlot {slot} {control} {onPrimary} {emphasis} />
  {:else if slot.kind === "sparkline" && control}
    <SparklineSlot {control} />
  {:else if slot.kind === "history-list" && control}
    <HistoryListSlot {control} count={Number(slot.options?.count ?? 4)} />
  {:else if needsControl && control}
    <ControlWidget {control} />
  {/if}
{/if}
