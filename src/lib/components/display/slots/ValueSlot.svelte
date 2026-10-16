<script lang="ts">
  import { splitValueUnit } from "$lib/config/format";
  import { logPointer } from "$lib/utils/dbg";
  import type { Slot } from "$lib/types/display";
  import type { SlotControl } from "$lib/types/device";

  let {
    slot,
    control,
    onPrimary,
    emphasis = "primary",
  }: {
    slot: Slot;
    control?: SlotControl;
    /** Set when this slot *is* the tile's action — then it is the button. */
    onPrimary?: () => void;
    /** The tile's main reading is bold; the rest are quieter. */
    emphasis?: "primary" | "secondary";
  } = $props();

  const decimals = $derived(
    typeof slot.options?.decimals === "number"
      ? slot.options.decimals
      : undefined,
  );

  const parts = $derived(
    control
      ? splitValueUnit(
          control.liveValue,
          // `hideUnit` drops the unit to save width; a boolean's unit is its
          // OFF/ON label and stays either way. `decimals` is the precision
          // knob — the reading rounds to it, trailing zeros drop.
          slot.options?.hideUnit === true
            ? undefined
            : (slot.unit ?? control.unit),
          decimals,
        )
      : { value: "—", unit: "" },
  );
</script>

{#if onPrimary}
  <button
    type="button"
    class="value mono action"
    class:secondary={emphasis === "secondary"}
    title="Toggle"
    onclick={(e) => {
      e.stopPropagation();
      logPointer("click value", e);
      onPrimary();
    }}
    >{parts.value}{#if parts.unit}<span class="unit">{parts.unit}</span
      >{/if}</button
  >
{:else}
  <span class="value mono" class:secondary={emphasis === "secondary"}
    >{parts.value}{#if parts.unit}<span class="unit">{parts.unit}</span
      >{/if}</span
  >
{/if}

<style>
  /* The main reading: the boldest text on the tile — heavier than the title
     (600), so the number owns the tile. A notch smaller than it used to be
     (0.95 → 0.90rem). */
  .value {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1.15;
    max-width: 100%;
    /* Wrap rather than truncate: on a narrow tile the unit drops to the next
       line ("49.23" / "%"), and the row grows to fit. A clipped number is a
       wrong number. */
    overflow-wrap: break-word;
  }

  /* Its unit: 20% smaller again, and not bold. */
  .value .unit {
    font-size: 0.72rem;
    font-weight: 400;
    margin-left: 0.15em;
  }

  /* Secondary readings (humidity, dew point, …): quiet, not bold. */
  .value.secondary {
    font-size: 0.84rem;
    font-weight: 400;
  }

  .value.secondary .unit {
    font-size: 0.67rem;
  }

  .value.action {
    padding: 1px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    background-color: var(--surface-container);
    color: inherit;
    cursor: pointer;
  }

  .value.action:hover {
    border-color: var(--primary-color);
  }
</style>
