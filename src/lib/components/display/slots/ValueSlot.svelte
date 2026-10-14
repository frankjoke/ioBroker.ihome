<script lang="ts">
  import { formatSlotText } from "$lib/config/format";
  import type { Slot } from "$lib/types/display";
  import type { EnrichedControl } from "$lib/types/device";

  let {
    slot,
    control,
    onPrimary,
  }: {
    slot: Slot;
    control?: EnrichedControl;
    /** Set when this slot *is* the tile's action — then it is the button. */
    onPrimary?: () => void;
  } = $props();

  const text = $derived(
    control
      ? formatSlotText(control.liveValue, slot.unit ?? control.unit)
      : "—",
  );
</script>

{#if onPrimary}
  <button
    type="button"
    class="value mono action"
    title="Toggle"
    onclick={(e) => {
      e.stopPropagation();
      onPrimary();
    }}>{text}</button
  >
{:else}
  <span class="value mono">{text}</span>
{/if}

<style>
  .value {
    font-family: var(--font-mono);
    font-size: var(--body-md, 0.95rem);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
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
