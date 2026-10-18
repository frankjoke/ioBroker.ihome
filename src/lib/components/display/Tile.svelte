<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { backgroundCss } from "$lib/config/appearance";
  import {
    pickSlotControls,
    primaryControl,
    resolveControl,
    resolveTemplate,
    slotVisible,
    tileTitle,
  } from "$lib/config/template-ops";
  import { evalActive, slotWhere } from "$lib/config/tile-ops";
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
  import { openSheet } from "$lib/stores/sheet.svelte.js";
  import SlotRenderer from "./SlotRenderer.svelte";
  import BadgeRow from "./BadgeRow.svelte";
  import TileModal from "./TileModal.svelte";
  import ModalPanel from "./ModalPanel.svelte";
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
    modalPreview,
    openModal = null,
    onModalClose,
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
    /** The editor's preview also renders the modal's look below the tile (A34). */
    modalPreview?: boolean;
    /** The layout sheet's "modal view": asks this tile to open its own modal
     *  (only the tile knows its modal's rows). `inline` asks for the
     *  non-blocking form. Absent → never asked. Closing needs no request: the
     *  asker unmounts this tile, and the modal goes with it. */
    openModal?: { inline?: boolean } | null;
    /** The modal closed, by its own close button. */
    onModalClose?: () => void;
  } = $props();

  /** Hidden controls are not part of the tile at all. */
  const shownControls = $derived(
    (device.controls ?? []).filter((c) => !c.hidden),
  );

  const template = $derived(
    resolveTemplate(device, getTemplateRegistry().templates),
  );
  const span = $derived(clampSpan(tile?.size ?? template.size, bp));
  // The name the tile shows: its own, else the device's — and nothing at all
  // when the placement says `""` (A41).
  const tileName = $derived(title ?? tileTitle(device));
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
        (r.slot.kind === "icon" || r.slot.kind === "frame" || r.control) &&
        slotStyle(r.slot, r.control).hidden !== true,
    ),
  );

  // A slot marked `options.background` renders over the content as the tile's
  // chart layer (A22); everything else is the tile's body. Where a slot lives
  // is its own choice (A34): "modal" leaves the tile, "both" stays here too.
  const backgroundSlots = $derived(
    resolved.filter(
      (r) =>
        r.slot.options?.background === true && slotWhere(r.slot) !== "modal",
    ),
  );
  const bodySlots = $derived(
    resolved.filter(
      (r) =>
        r.slot.options?.background !== true && slotWhere(r.slot) !== "modal",
    ),
  );
  /**
   * The modal's slots (A34) — resolved the same way, so every kind works. The
   * chart layer comes along as a plain row there; badges take the path below.
   */
  const modalSlots = $derived(
    resolved.filter((r) => slotWhere(r.slot) !== "tile"),
  );
  const modalRows = $derived(
    modalSlots.map((r) => ({
      // The chart layer loses its stretch in the modal: there it is a plain
      // sparkline row, not a background.
      slot:
        r.slot.options?.background === true
          ? { ...r.slot, options: { ...r.slot.options, background: undefined } }
          : r.slot,
      control: r.control,
      style: slotStyle(r.slot, r.control),
      // The slot that *is* the tile's action stays a button in the modal too.
      onPrimary: r.control && r.control === primary ? togglePrimary : undefined,
    })),
  );

  /** The tile's first reading is the headline; the rest are supporting. The row
   *  itself is the identity (A35): two identical slots are legal config and must
   *  render side by side, only the first of them as the headline. */
  const mainValueRow = $derived(bodySlots.find((r) => r.slot.kind === "value"));

  // The icon slot carries the type's on/off colour and glow, so it drives the
  // tile's accent; the values reach CSS through custom properties (spec §6).
  const iconSlot = $derived(
    slots.find((s) => s.kind === "icon") ?? { kind: "icon" as const },
  );
  const tileStyle = $derived(slotStyle(iconSlot, controlFor(iconSlot)));
  // The tile's own painted background first (A33): a rule's background is
  // appended after it, so the live condition still wins.
  const tileVars = $derived(
    `${backgroundCss(tile?.background)} --tile-accent: ${
      tileStyle.color ?? "transparent"
    }; --tile-glow: ${
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
  // State-hidden badges drop out with the rest (A30); one marked "modal" leaves
  // the tile for the modal's chip strip (A34).
  const badgeSlots = $derived(
    slots.filter(
      (s) =>
        s.kind === "badge" &&
        slotVisible(s, active) &&
        slotWhere(s) !== "modal",
    ),
  );

  /** The modal's badges (A34): the same chips, in sequence under its title —
   *  a badge's corner anchor is the tile's language, not the modal's. */
  const modalBadges = $derived(
    slots
      .filter(
        (s) =>
          s.kind === "badge" &&
          slotVisible(s, active) &&
          slotWhere(s) !== "tile",
      )
      .flatMap((s) =>
        resolveBadges(
          [s],
          device,
          clock,
          Date.now(),
          getVirtualPool(),
          rawControl,
        ),
      ),
  );

  /** Something to enlarge into (A34): rows or badges. */
  const hasModal = $derived(modalRows.length > 0 || modalBadges.length > 0);

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
   * Open this tile's placement in the layout editor (A16). A tile rendered
   * without an anchor — an editor preview, say — falls back to the device form;
   * the device shortcut was the stopgap while no tile editor existed.
   */
  function openEditor() {
    if (anchor) {
      requestLayoutConfig(anchor);
      openSheet();
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
    // the icon and the On/Off text — so nothing switches by accident. The
    // modal only opens when slots live in it (A34); otherwise a stray tap on a
    // light would be the last thing between you and a switched-on lamp.
    if (hasModal) modalOpen = true;
  }

  let modalOpen = $state(false);
  let modalInline = $state(false);

  // The sheet's "modal view": it asks this tile to open the modal it owns — the
  // real one, because only the tile resolves its rows. Only *opening* is a
  // request: the asker unmounts this tile to close it, so there is no stale
  // "close" token to fire on the next mount.
  $effect(() => {
    const ask = openModal;
    if (!ask) return;
    untrack(() => {
      modalInline = ask.inline === true;
      modalOpen = true;
    });
  });
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
  class:interactive={hasModal}
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
      {#each backgroundSlots as r, i (i)}
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
  {#if tileName}<span class="tile-name">{tileName}</span>{/if}
  <div class="tile-body">
    {#each bodySlots as r, i (i)}
      <SlotRenderer
        slot={r.slot}
        {device}
        control={r.control}
        style={slotStyle(r.slot, r.control)}
        onPrimary={r.control && r.control === primary
          ? togglePrimary
          : undefined}
        emphasis={r === mainValueRow ? "primary" : "secondary"}
      />
    {/each}
  </div>
  {#each BADGE_ANCHORS as anchor (anchorKey(anchor))}
    <BadgeRow badges={badgeGroups[anchorKey(anchor)] ?? []} {anchor} />
  {/each}
</div>

{#if modalPreview}
  <!-- What a long-press opens, beside the tile — the same panel the dialog
       renders (A34), so shifting a slot is visible on both sides at once. -->
  {#if hasModal}
    <div class="modal-preview">
      <ModalPanel
        {device}
        {title}
        background={tile?.background}
        rows={modalRows}
        badges={modalBadges}
        bodyMaxHeight="30vh"
      />
    </div>
  {:else}
    <p class="modal-preview text-muted">No slot lives in the modal.</p>
  {/if}
{/if}

{#if modalOpen}
  <TileModal
    {device}
    {title}
    background={tile?.background}
    rows={modalRows}
    badges={modalBadges}
    inline={modalInline}
    onClose={() => {
      modalOpen = false;
      onModalClose?.();
    }}
  />
{/if}

<style>
  /* The preview's modal panel (A34): it is a grid sibling of the tile, so it
     spans the tile grid's whole width and sits below. */
  .modal-preview {
    grid-column: 1 / -1;
  }

  p.modal-preview {
    margin: 0.25rem 0 0;
    font-size: var(--body-sm);
  }

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

  /* A slot marked `options.background` draws the tile's chart (A22) over the
     content — the icon and values sit under it, so the line is never hidden.
     No pointer events; clipped to the tile's rounded box; the badges (z 2)
     stay on top. The chart is centred at 70% of the tile's height so the
     badge corners and the name keep their space. */
  .tile-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
    z-index: 1;
    display: flex;
    align-items: center;
  }

  /* Stretch the chart across the tile: the sparkline ships a fixed size for the
     in-body case, and a scoped style cannot reach into the child. */
  .tile-bg :global(.spark) {
    width: 100%;
    max-width: none;
    height: 70%;
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
    /* Grow into the tile's leftover height so a frame slot can fill it, and be
       full width for the same reason: the tile centres its items, so a
       shrink-to-fit body would leave a frame at the iframe's own 300px default
       (the tile grew, the page did not). Every other kind keeps its size. */
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
  }
</style>
