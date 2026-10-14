<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { applyWrite } from "$lib/utils/transform";
  import { resolveTemplate, primaryControl } from "$lib/config/template-ops";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { clampSpan, type Breakpoint } from "$lib/config/size-ops";
  import SlotRenderer from "./SlotRenderer.svelte";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";
  import type { Slot } from "$lib/types/display";

  let { device, bp }: { device: EnrichedDevice; bp: Breakpoint } = $props();

  const template = $derived(
    resolveTemplate(device, getTemplateRegistry().templates),
  );
  const span = $derived(clampSpan(template.size, bp));
  const primary = $derived(primaryControl(device.controls));

  // Spec §4.1: a slot's source resolves control feature → control id → state id.
  function controlFor(slot: Slot): EnrichedControl | undefined {
    if (!slot.source) return undefined;
    const controls = device.controls ?? [];
    return (
      controls.find((c) => c.feature === slot.source) ??
      controls.find((c) => c.id === slot.source) ??
      controls.find((c) => c.stateId === slot.source)
    );
  }

  // Slots that render nothing are dropped, so a template can name features a
  // device does not have without leaving gaps (spec §10).
  const slots = $derived(
    template.slots.filter((slot) => {
      if (slot.kind === "badge") return false; // badges render as a row (Task 11)
      if (slot.kind === "icon") return true;
      return !!controlFor(slot);
    }),
  );

  function truthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function onActivate() {
    // The body acts on the primary control: toggle a switch, else nothing yet
    // (the full-control modal arrives in Task 13).
    if (!primary || primary.widget !== "switch" || !primary.writable) return;
    if (!primary.stateId) return;
    const v = applyWrite(!truthy(primary.liveValue), primary.transform);
    ioBroker.setState(primary.stateId, v).catch((e: unknown) => {
      console.warn("Failed to set state:", e);
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onActivate();
  }
</script>

<!-- The tile is only focusable when its body can actually act (a writable
     switch), which the checker cannot see through the conditional attribute. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="tile"
  style="grid-column: span {span.w}; grid-row: span {span.h};"
  class:interactive={primary?.widget === "switch" && primary.writable}
  role={primary?.widget === "switch" && primary.writable ? "button" : undefined}
  tabindex={primary?.widget === "switch" && primary.writable ? 0 : undefined}
  onclick={onActivate}
  onkeydown={onKey}
>
  <span class="tile-name">{device.name}</span>
  <div class="tile-body">
    {#each slots as slot (`${slot.kind}:${slot.source ?? ""}`)}
      <SlotRenderer {slot} {device} control={controlFor(slot)} style={{}} />
    {/each}
  </div>
</div>

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.5rem;
    min-width: 0;
    overflow: hidden;
    text-align: center;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-container-lowest);
  }

  .tile.interactive {
    cursor: pointer;
  }

  .tile.interactive:hover {
    background-color: var(--surface-container);
  }

  .tile-name {
    font-size: var(--body-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
    max-width: 100%;
  }

  .tile-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    max-width: 100%;
  }
</style>
