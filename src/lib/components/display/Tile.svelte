<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { applyWrite } from "$lib/utils/transform";
  import { resolveTemplate, primaryControl } from "$lib/config/template-ops";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getVirtualPool } from "$lib/stores/devices";
  import { resolveStyle, ruleScope } from "$lib/config/rule-ops";
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

  // Rule locals are the device's controls (by label, falling back to feature) plus
  // the pool helpers — the same language the formula editor uses.
  const scope = $derived(ruleScope(device.controls ?? [], getVirtualPool()));

  /** Slot rules first, the control's own defaults last — the last match wins. */
  function slotStyle(slot: Slot, control?: EnrichedControl) {
    return resolveStyle(
      [...(slot.rules ?? []), ...(control?.rules ?? [])],
      scope,
    );
  }

  // Slots that render nothing are dropped, so a template can name features a
  // device does not have without leaving gaps (spec §10), and a rule can hide a
  // slot by value.
  const slots = $derived(
    template.slots.filter((slot) => {
      if (slot.kind === "badge") return false; // badges render as a row (Task 11)
      const control = controlFor(slot);
      if (slotStyle(slot, control).hidden === true) return false;
      if (slot.kind === "icon") return true;
      return !!control;
    }),
  );

  // The icon slot carries the type's on/off colour and glow, so it drives the
  // tile's accent; the values reach CSS through custom properties (spec §6).
  const iconSlot = $derived(
    template.slots.find((s) => s.kind === "icon") ?? { kind: "icon" as const },
  );
  const tileStyle = $derived(slotStyle(iconSlot, controlFor(iconSlot)));
  const tileVars = $derived(
    `--tile-accent: ${tileStyle.color ?? "transparent"}; --tile-glow: ${
      tileStyle.glow ? 1 : 0
    };`,
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
  class:glow={tileStyle.glow === true}
  style="grid-column: span {span.w}; grid-row: span {span.h}; {tileVars}"
  class:interactive={primary?.widget === "switch" && primary.writable}
  role={primary?.widget === "switch" && primary.writable ? "button" : undefined}
  tabindex={primary?.widget === "switch" && primary.writable ? 0 : undefined}
  onclick={onActivate}
  onkeydown={onKey}
>
  <span class="tile-name">{device.name}</span>
  <div class="tile-body">
    {#each slots as slot (`${slot.kind}:${slot.source ?? ""}`)}
      <SlotRenderer
        {slot}
        {device}
        control={controlFor(slot)}
        style={slotStyle(slot, controlFor(slot))}
      />
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

  /* One shared glow rule: a static shadow, no animation (a wall tablet should
     not burn CPU animating tiles). */
  .tile.glow {
    box-shadow: 0 0 12px var(--tile-accent);
    border-color: var(--tile-accent, var(--border-color));
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
