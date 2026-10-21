<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
  import ControlWidget from "./slots/ControlWidget.svelte";
  import ValueSlot from "./slots/ValueSlot.svelte";
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
    icon,
    stack = false,
    anchor = false,
  }: {
    slot: Slot;
    device: EnrichedDevice;
    control?: SlotControl;
    style: { icon?: string; color?: string; disabled?: boolean };
    onPrimary?: () => void;
    emphasis?: "primary" | "secondary";
    /** The slot's own icon (A51/A53), resolved by the tile: glyph, dressed
     *  colour, dim — and the size the emphasis asks for. */
    icon?: { glyph: string; color?: string; disabled?: boolean; size?: number };
    /** The primary cluster at a 1-wide span: icon above the value (A53). */
    stack?: boolean;
    /** The headline row: the tile measures its glyph for the chart band. */
    anchor?: boolean;
  } = $props();

  // Kinds with a control are useless without one; value falls back.
  const needsControl = $derived(
    slot.kind === "level" ||
      slot.kind === "color" ||
      slot.kind === "enum" ||
      slot.kind === "button" ||
      slot.kind === "history-list",
  );
  const show = $derived(!needsControl || !!control);
</script>

{#snippet content()}
  <!-- The control-bearing kinds below only open up for a control that resolved
       from the device (a raw-state pseudo-control reaches the value kind only),
       so the cast to the full enriched shape is safe. -->
  {#if slot.kind === "value"}
    <ValueSlot {slot} {control} {onPrimary} {emphasis} />
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
{/snippet}

{#if show}
  {#if icon}
    <!-- The slot's icon and its reading, one cluster (A53): side by side when
         the line fits; the headline stacks at a 1-wide span so a 1×1 tile puts
         the icon above the value. -->
    <div
      class="slot-cluster"
      class:stack
      data-chart-anchor={anchor ? "" : undefined}
    >
      {#if onPrimary}
        <!-- The slot's own action (A51/A53): the icon toggles with the value,
             as the retired IconSlot's button did. -->
        <button
          type="button"
          class="slot-icon action"
          title="Toggle"
          aria-label="Toggle"
          style:color={icon.color}
          onclick={(e) => {
            e.stopPropagation();
            onPrimary();
          }}
        >
          <Icon value={icon.glyph} size={icon.size ?? 17} dim={icon.disabled} />
        </button>
      {:else}
        <span class="slot-icon" style:color={icon.color}>
          <Icon value={icon.glyph} size={icon.size ?? 17} dim={icon.disabled} />
        </span>
      {/if}
      {@render content()}
    </div>
  {:else}
    {@render content()}
  {/if}
{/if}

<style>
  .slot-cluster {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-width: 0;
    max-width: 100%;
  }

  .slot-cluster.stack {
    flex-direction: column;
    gap: 0.1rem;
  }

  .slot-icon {
    display: inline-flex;
    align-items: center;
  }

  /* The icon as the slot's action keeps the glyph's box exactly: no chrome,
     only the pointer and a keyboard focus ring. */
  .slot-icon.action {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    border-radius: var(--border-radius-pill);
  }

  .slot-icon.action:focus-visible {
    box-shadow: 0 0 0 2px var(--primary-color);
  }
</style>
