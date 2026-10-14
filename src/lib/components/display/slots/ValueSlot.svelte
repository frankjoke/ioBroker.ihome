<script lang="ts">
  import { formatValue } from "$lib/config/format";
  import type { Slot } from "$lib/types/display";
  import type { EnrichedControl } from "$lib/types/device";

  let { slot, control }: { slot: Slot; control?: EnrichedControl } = $props();

  const text = $derived(
    control ? formatValue(control.liveValue, slot.unit ?? control.unit) : "—",
  );
</script>

<span class="value mono">{text}</span>

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
</style>
