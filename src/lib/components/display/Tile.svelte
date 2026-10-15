<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { logPointer } from "$lib/utils/dbg";
  import {
    pickControl,
    primaryControl,
    resolveControl,
    resolveTemplate,
    tileTitle,
  } from "$lib/config/template-ops";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getVirtualPool } from "$lib/stores/devices";
  import {
    badgePosition,
    resolveBadges,
    resolveStyle,
    ruleScope,
    type BadgeCorner,
    type ResolvedBadge,
    type TimeSource,
  } from "$lib/config/rule-ops";
  import { clampSpan, type Breakpoint } from "$lib/config/size-ops";
  import { requestDeviceConfig, wantsDeviceConfig } from "$lib/pages.js";
  import SlotRenderer from "./SlotRenderer.svelte";
  import BadgeRow from "./BadgeRow.svelte";
  import TileModal from "./TileModal.svelte";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";
  import type { Slot } from "$lib/types/display";

  let { device, bp }: { device: EnrichedDevice; bp: Breakpoint } = $props();

  /** Hidden controls are not part of the tile at all. */
  const shownControls = $derived(
    (device.controls ?? []).filter((c) => !c.hidden),
  );

  const template = $derived(
    resolveTemplate(device, getTemplateRegistry().templates),
  );
  const span = $derived(clampSpan(template.size, bp));
  const primary = $derived(primaryControl(shownControls));

  /** The shape a readout hint matches against: role, label, unit. */
  function pickable(controls: EnrichedControl[]) {
    return controls.map((c) => ({
      id: c.id,
      role: c.object?.common?.role ?? c.common?.role,
      unit: c.unit,
      label: c.label ?? c.feature,
    }));
  }

  // Spec §4.1 + label fallback: feature → control id → state id → label.
  function controlFor(slot: Slot): EnrichedControl | undefined {
    if (!slot.source) return undefined;
    return resolveControl(shownControls, slot.source);
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
  /**
   * Slots and the controls they show, resolved in one pass.
   *
   * A slot with no `source` takes the next control no earlier slot has used —
   * that is how a readout preset says "show two values" without knowing what the
   * device calls them (`Temperatur`/`Luftfeuchtigkeit` carry no feature the
   * preset could match).
   */
  const resolved = $derived.by(() => {
    const used = new Set<string>();
    const out: { slot: Slot; control?: EnrichedControl }[] = [];
    for (const slot of template.slots) {
      if (slot.kind === "badge") continue; // badges live in the corners
      // A readout hint is matched against the pickable shape, then mapped back
      // to the control it names; position is only the fallback.
      const picked = slot.source
        ? undefined
        : pickControl(
            pickable(shownControls),
            String(slot.options?.pick ?? ""),
            used,
          );
      const control = slot.source
        ? controlFor(slot)
        : ((picked
            ? shownControls.find((c) => c.id === picked.id)
            : undefined) ?? shownControls.find((c) => !used.has(c.id)));
      if (control) used.add(control.id);
      if (slot.kind !== "icon" && !control) continue;
      if (slotStyle(slot, control).hidden === true) continue;
      out.push({ slot, control });
    }
    return out;
  });

  const slots = $derived(resolved.map((r) => r.slot));

  /** The tile's first reading is the headline; the rest are supporting. */
  const mainValueKey = $derived(
    (() => {
      const first = resolved.find((r) => r.slot.kind === "value");
      return first
        ? `${first.slot.kind}:${first.slot.source ?? ""}:${first.slot.options?.index ?? ""}`
        : "";
    })(),
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
    };${tileStyle.background ? ` background-color: ${tileStyle.background};` : ""}`,
  );

  /**
   * Badge clock. `at()` answers "when did this control last report/change?";
   * with no source it falls back to the newest timestamp on the device, which is
   * the right question for a sensor but the wrong one for a motion detector —
   * hence `options.of` on the badge (see `rule-ops`).
   */
  const clock: TimeSource = {
    at(source, from) {
      const states = ioBroker.states as Map<string, any>;
      const pick = (stateId: string | undefined) => {
        if (!stateId) return undefined;
        const st = states.get(stateId);
        // "last change", or the last update when the broker has no lc for it.
        const v = from === "lc" ? (st?.lc ?? st?.ts) : st?.ts;
        return typeof v === "number" ? v : undefined;
      };
      if (source) {
        const control = resolveControl(shownControls, source);
        if (control) return pick(control.stateId);
        return pick(source); // a raw state id
      }
      let latest: number | undefined;
      for (const c of controls0()) {
        const v = pick(c.stateId);
        if (typeof v === "number" && (latest === undefined || v > latest)) {
          latest = v;
        }
      }
      return latest;
    },
  };

  function controls0() {
    return (device.controls ?? []).filter((c) => !c.hidden);
  }

  // Badges render once, at the end of the tile, wherever the badge slots sit in
  // the template. `ago` and `offline` need no control: they read the device.
  const badgeSlots = $derived(template.slots.filter((s) => s.kind === "badge"));

  // Badges land in the corner their kind belongs to (spec §6), so the layout of
  // a tile carries meaning instead of being one row at the bottom.
  const corners = $derived.by(() => {
    const byCorner: Record<BadgeCorner, ResolvedBadge[]> = {
      "top-left": [],
      "top-right": [],
      "bottom-left": [],
      "bottom-right": [],
    };
    for (const slot of badgeSlots) {
      for (const badge of resolveBadges(
        [slot],
        device,
        clock,
        Date.now(),
        getVirtualPool(),
      )) {
        byCorner[badgePosition(slot)].push(badge);
      }
    }
    return byCorner;
  });

  function truthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  /** The one action a tile can perform: toggle its primary switch. */
  function togglePrimary() {
    if (!primary || primary.widget !== "switch") return;
    const from = truthy(primary.liveValue);
    // Guarded and locked: two arrivals of the same press (a double click, a
    // duplicated handler) must not become two toggles.
    const sent = writeControl(ioBroker, primary, !from, Date.now(), {
      lockMs: 3000,
    });
    // Debug tracing for the intermittent double-toggle (grep "ihome-dbg").
    console.log(
      `[ihome-dbg] tile toggle ${primary.stateId} from=${from} to=${!from} ${sent ? "sent" : "REFUSED"} @${Date.now()}`,
    );
  }

  /**
   * A control the tile does not already show. The enlargement only earns a click
   * when there is something more to show — otherwise a stray tap on a light
   * would be the last thing between you and a switched-on lamp.
   */
  const extraControls = $derived(
    shownControls.filter((c) => !resolved.some((r) => r.control === c)),
  );

  /** Ctrl/Cmd+click anywhere on the tile -> that device's config. */
  function openDeviceConfig() {
    requestDeviceConfig(device.id);
    location.hash = "#/devices";
  }

  function onCapture(event: MouseEvent) {
    // Capture phase: this sees *every* click inside the tile, including one that
    // landed on no button at all — the case a held press can produce.
    logPointer("click tile-capture", event);
    if (!wantsDeviceConfig(event)) return;
    // Capture phase: the action buttons stopPropagation, so without this a
    // Ctrl+click on a light's icon would just switch the light.
    event.stopPropagation();
    event.preventDefault();
    openDeviceConfig();
  }

  function onActivate(event?: MouseEvent) {
    // Ctrl/Cmd+click is the shortcut to the device's config — the one place a
    // tile cannot reach on its own.
    if (wantsDeviceConfig(event)) {
      openDeviceConfig();
      return;
    }
    // A long-press already opened the modal; swallow the click it produced.
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Body tap = enlarge (spec §7). The action lives on the control itself —
    // the icon and the On/Off text — so nothing switches by accident.
    if (extraControls.length) modalOpen = true;
  }

  let modalOpen = $state(false);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;

  /** Touch long-press (500 ms) opens the modal, like the corner affordance. */
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      modalOpen = true;
    }, 500);
  }

  function cancelPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function onKey(e: KeyboardEvent) {
    // Enter/Space on a nested control (a slider, a select, a button) must do its
    // own thing, not the tile's.
    if (e.target !== e.currentTarget) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    // Cmd/Ctrl+Enter is the keyboard form of the config shortcut.
    onActivate(
      wantsDeviceConfig(e) ? ({ metaKey: true } as MouseEvent) : undefined,
    );
  }
</script>

<!-- The tile is only focusable when its body can actually act (a writable
     switch), which the checker cannot see through the conditional attribute. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="tile"
  class:glow={tileStyle.glow === true}
  class:disabled={tileStyle.disabled === true}
  class:has-top-badge={corners["top-left"].length > 0 ||
    corners["top-right"].length > 0}
  class:has-bottom-badge={corners["bottom-left"].length > 0 ||
    corners["bottom-right"].length > 0}
  style="grid-column: span {span.w}; grid-row: span {span.h}; {tileVars}"
  class:interactive={extraControls.length > 0}
  role={primary?.widget === "switch" && primary.writable ? "button" : undefined}
  tabindex={primary?.widget === "switch" && primary.writable ? 0 : undefined}
  onclickcapture={onCapture}
  onclick={onActivate}
  onkeydown={onKey}
  onpointerdowncapture={(e) => logPointer("down", e)}
  onpointerupcapture={(e) => logPointer("up", e)}
  onpointerdown={onPointerDown}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  onpointerleave={cancelPress}
>
  <span class="tile-name">{tileTitle(device)}</span>
  <div class="tile-body">
    {#each resolved as r (`${r.slot.kind}:${r.slot.source ?? ""}:${r.slot.options?.index ?? ""}`)}
      <SlotRenderer
        slot={r.slot}
        {device}
        control={r.control}
        style={slotStyle(r.slot, r.control)}
        onPrimary={r.control && r.control === primary
          ? togglePrimary
          : undefined}
        emphasis={`${r.slot.kind}:${r.slot.source ?? ""}:${r.slot.options?.index ?? ""}` ===
        mainValueKey
          ? "primary"
          : "secondary"}
      />
    {/each}
  </div>
  <BadgeRow badges={corners["top-left"]} corner="top-left" />
  <BadgeRow badges={corners["top-right"]} corner="top-right" />
  <BadgeRow badges={corners["bottom-left"]} corner="bottom-left" />
  <BadgeRow badges={corners["bottom-right"]} corner="bottom-right" />
</div>

{#if modalOpen}
  <TileModal {device} onClose={() => (modalOpen = false)} />
{/if}

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Top-aligned, not centred: side-by-side tiles in a row then share their
       baselines instead of floating to different heights. */
    justify-content: flex-start;
    gap: 0.2rem;
    padding: 6px 3px 3px;
    min-width: 0;
    /* No overflow clipping: a badge is allowed to sit on the tile's own edge. */
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

  /* A badge that pokes into the corner must not sit on a value: reserve the band
     it occupies, only on tiles that actually have one (a scoped style cannot
     reach into the BadgeRow child, so the tile tells us itself). */
  .tile.has-top-badge {
    padding-top: 15px;
  }

  .tile.has-bottom-badge {
    padding-bottom: 15px;
  }

  /* A rule can ask for the switched-off look. */
  .tile.disabled {
    opacity: 0.6;
  }

  .tile-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
    max-width: 100%;
  }
</style>
