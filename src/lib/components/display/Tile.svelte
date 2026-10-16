<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import {
    pickSlotControls,
    primaryControl,
    resolveControl,
    resolveTemplate,
    slotVisible,
    tileTitle,
  } from "$lib/config/template-ops";
  import { evalActive } from "$lib/config/tile-ops";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getVirtualPool } from "$lib/stores/devices";
  import {
    anchorKey,
    BADGE_ANCHORS,
    badgePositions,
    resolveBadges,
    resolveStyle,
    ruleScope,
    truthy,
    type ResolvedBadge,
    type TimeSource,
  } from "$lib/config/rule-ops";
  import { clampSpan, type Breakpoint } from "$lib/config/size-ops";
  import {
    requestDeviceConfig,
    requestLayoutConfig,
    wantsDeviceConfig,
  } from "$lib/pages.js";
  import SlotRenderer from "./SlotRenderer.svelte";
  import BadgeRow from "./BadgeRow.svelte";
  import TileModal from "./TileModal.svelte";
  import type {
    EnrichedControl,
    EnrichedDevice,
    SlotControl,
  } from "$lib/types/device";
  import type { Rule, Slot, TileConfig } from "$lib/types/display";
  import type { PlacementAnchor } from "$lib/config/layout-ops";

  let {
    device,
    bp,
    title,
    tile,
    anchor,
    newLine,
  }: {
    device: EnrichedDevice;
    bp: Breakpoint;
    /** The placement's title wins over the one derived from the device. */
    title?: string;
    /** The placement's own config: its size wins over the template's (A9). */
    tile?: TileConfig;
    /** Where this tile sits on a page — what the display hands the editor (A16). */
    anchor?: PlacementAnchor;
    /** The tree asks for a line break before this tile. */
    newLine?: boolean;
  } = $props();

  /** Hidden controls are not part of the tile at all. */
  const shownControls = $derived(
    (device.controls ?? []).filter((c) => !c.hidden),
  );

  const template = $derived(
    resolveTemplate(device, getTemplateRegistry().templates),
  );
  const span = $derived(clampSpan(tile?.size ?? template.size, bp));
  const primary = $derived(primaryControl(shownControls));

  // Spec §4.1 + label fallback: feature → control id → state id → label.
  function controlFor(slot: Slot): EnrichedControl | undefined {
    if (!slot.source) return undefined;
    return resolveControl(shownControls, slot.source);
  }

  // Rule locals are the device's controls (by label, falling back to feature) plus
  // the pool helpers — the same language the formula editor uses.
  const baseScope = $derived(
    ruleScope(device.controls ?? [], getVirtualPool()),
  );

  // The tile's active reading (A30): its condition over the live value of the
  // control or raw state it names; no condition means never active.
  const activeCond = $derived(tile?.active);
  const activeControl = $derived(
    activeCond?.source
      ? (resolveControl(shownControls, activeCond.source) ??
          rawControl(activeCond.source))
      : undefined,
  );
  const active = $derived(evalActive(activeCond, activeControl?.liveValue));
  // The tile's own flag wins the name `active` over a control alias of the same
  // name, so `when: "active"` always means the tile's state.
  const scope = $derived({
    ...baseScope,
    locals: { ...baseScope.locals, active },
  });

  /** Slot rules first, the control's own defaults last — the last match wins. */
  function slotStyle(slot: Slot, control?: SlotControl & { rules?: Rule[] }) {
    return resolveStyle(
      [...(slot.rules ?? []), ...(control?.rules ?? [])],
      scope,
    );
  }

  /** The tile's own slots once it was materialised; the chain's until then (A18).
   *  Slots that render nothing are dropped by the pass below, so a template can
   *  name features a device does not have without leaving gaps (spec §10). */
  const slots = $derived(tile?.slots ?? template.slots);

  /**
   * A raw state id as a read-only pseudo-control (A21): a slot may name any state
   * the document carries, not only a control of this device. Only the state's
   * own object makes it one — a feature name like "power" is not a state.
   */
  function rawControl(source: string): SlotControl | undefined {
    const obj = (ioBroker.objects as Map<string, any>)?.get?.(source);
    if (!obj) return undefined;
    const state = (ioBroker.states as Map<string, any>)?.get?.(source);
    return {
      id: source,
      stateId: source,
      label: obj.common?.name ?? source,
      unit: obj.common?.unit,
      liveValue: state?.val,
      writable: false,
    };
  }

  /**
   * Slots and the controls they show, resolved in one pass (A20/A21): state-
   * hidden slots drop out first, then `source` (a control, or a raw state via
   * `rawControl`), then a hint, then the next control no earlier slot used. A
   * source or hint that matches nothing goes dormant instead of falling back to
   * position; the slots that actually render are the ones with a reading (an
   * icon slot keeps its fallback) that no rule hides.
   */
  const resolved = $derived(
    pickSlotControls<SlotControl>(slots, shownControls, {
      active,
      raw: rawControl,
    }).filter(
      (r) =>
        (r.slot.kind === "icon" || r.control) &&
        slotStyle(r.slot, r.control).hidden !== true,
    ),
  );

  // A slot marked `options.background` renders behind the content (the history
  // chart, A22); everything else is the tile's body.
  const backgroundSlots = $derived(
    resolved.filter((r) => r.slot.options?.background === true),
  );
  const bodySlots = $derived(
    resolved.filter((r) => r.slot.options?.background !== true),
  );

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
    slots.find((s) => s.kind === "icon") ?? { kind: "icon" as const },
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
  // State-hidden badges drop out with the rest (A30).
  const badgeSlots = $derived(
    slots.filter((s) => s.kind === "badge" && slotVisible(s, active)),
  );

  // Where each visible badge sits: an explicit x/y on the slot, or the next
  // free corner (top-right first) — see `badgePositions`.
  const badgeGroups = $derived.by(() => {
    const anchors = badgePositions(badgeSlots);
    const byAnchor: Record<string, ResolvedBadge[]> = {};
    badgeSlots.forEach((slot, i) => {
      for (const badge of resolveBadges(
        [slot],
        device,
        clock,
        Date.now(),
        getVirtualPool(),
        rawControl,
      )) {
        const key = anchorKey(anchors[i]);
        (byAnchor[key] ??= []).push(badge);
      }
    });
    return byAnchor;
  });

  /** The one action a tile can perform: toggle its primary switch. */
  function togglePrimary() {
    if (!primary || primary.widget !== "switch") return;
    const from = truthy(primary.liveValue);
    // Guarded and locked: two arrivals of the same press (a double click, a
    // duplicated handler) must not become two toggles.
    writeControl(ioBroker, primary, !from, Date.now(), {
      lockMs: 3000,
    });
  }

  /**
   * A control the tile does not already show. The enlargement only earns a click
   * when there is something more to show — otherwise a stray tap on a light
   * would be the last thing between you and a switched-on lamp.
   */
  const extraControls = $derived(
    shownControls.filter((c) => !resolved.some((r) => r.control === c)),
  );

  /**
   * Open this tile's placement in the layout editor (A16). A tile rendered
   * without an anchor — an editor preview, say — falls back to the device form;
   * the device shortcut was the stopgap while no tile editor existed.
   */
  function openEditor() {
    if (anchor) {
      requestLayoutConfig(anchor);
      location.hash = "#/layout";
      return;
    }
    requestDeviceConfig(device.id);
    location.hash = "#/devices";
  }

  function onCapture(event: MouseEvent) {
    if (!wantsDeviceConfig(event)) return;
    // Capture phase: the action buttons stopPropagation, so without this a
    // Ctrl+click on a light's icon would just switch the light.
    event.stopPropagation();
    event.preventDefault();
    openEditor();
  }

  function onActivate(event?: MouseEvent) {
    // Ctrl/Cmd+click is the shortcut to the editor — the one place a tile cannot
    // reach on its own.
    if (wantsDeviceConfig(event)) {
      openEditor();
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
  class:active
  class:glow={tileStyle.glow === true}
  class:disabled={tileStyle.disabled === true}
  style="grid-column: {newLine
    ? '1'
    : 'auto'} / span {span.w}; grid-row: span {span.h}; {tileVars}"
  class:interactive={extraControls.length > 0}
  role={primary?.widget === "switch" && primary.writable ? "button" : undefined}
  tabindex={primary?.widget === "switch" && primary.writable ? 0 : undefined}
  onclickcapture={onCapture}
  onclick={onActivate}
  onkeydown={onKey}
  onpointerdown={onPointerDown}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  onpointerleave={cancelPress}
>
  {#if backgroundSlots.length}
    <div class="tile-bg">
      {#each backgroundSlots as r (`bg:${r.slot.kind}:${r.slot.source ?? ""}:${r.slot.options?.index ?? ""}`)}
        <SlotRenderer
          slot={r.slot}
          {device}
          control={r.control}
          style={slotStyle(r.slot, r.control)}
          emphasis="secondary"
        />
      {/each}
    </div>
  {/if}
  <span class="tile-name">{title ?? tileTitle(device)}</span>
  <div class="tile-body">
    {#each bodySlots as r (`${r.slot.kind}:${r.slot.source ?? ""}:${r.slot.options?.index ?? ""}`)}
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
  {#each BADGE_ANCHORS as anchor (anchorKey(anchor))}
    <BadgeRow badges={badgeGroups[anchorKey(anchor)] ?? []} {anchor} />
  {/each}
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

  /* Active (A30): the accent border only — glow stays rule territory. */
  .tile.active {
    border-color: var(--tile-accent, var(--primary-color));
  }

  /* A slot marked `options.background` renders behind everything (the history
     chart, A22): no pointer events, clipped to the tile's rounded box. */
  .tile-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
  }

  /* Stretch the chart across the tile: the sparkline ships a fixed size for the
     in-body case, and a scoped style cannot reach into the child. */
  .tile-bg :global(.spark) {
    width: 100%;
    max-width: none;
    height: 100%;
  }

  .tile-bg :global(.spark-placeholder) {
    display: none;
  }

  .tile-name {
    font-size: var(--body-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
    max-width: 100%;
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
