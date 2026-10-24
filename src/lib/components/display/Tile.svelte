<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { backgroundCss } from "$lib/config/appearance";
  import {
    primaryControl,
    resolveControl,
    resolveTemplate,
    tileTitle,
  } from "$lib/config/template-ops";
  import { evalActive } from "$lib/config/tile-ops";
  import {
    headlineSlot,
    rowIcon,
    rowSpark,
    stateLook,
    tileParts,
    tileSeries,
    type SlotRow,
  } from "$lib/config/tile-parts";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getVirtualPool } from "$lib/stores/devices";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    stateIdFor,
    variableScope,
    type VariableScope,
  } from "$lib/config/variables";
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
  import { openSheetGated } from "$lib/stores/sheet.svelte.js";
  import { getStorage } from "$lib/tools.svelte";
  import {
    isUnlocked,
    pencilNeedsPin,
    tileNeedsPin,
  } from "$lib/config/pin.svelte";
  import SlotRenderer from "./SlotRenderer.svelte";
  import TileChart from "./TileChart.svelte";
  import BadgeRow from "./BadgeRow.svelte";
  import TileModal from "./TileModal.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";
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
    openModal = null,
    onModalClose,
    onDetail,
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
    /** The layout sheet's "modal view": asks this tile to open its own modal
     *  (only the tile knows its modal's rows). `inline` asks for the
     *  non-blocking form. Absent → never asked; withdrawn → it closes. */
    openModal?: { inline?: boolean } | null;
    /** The modal closed, by its own close button. */
    onModalClose?: () => void;
    /** Whether anything lives in the detail page — the resolution above, handed
     *  out so the sheet's Detail Page checkbox asks the tile's own answer (A47). */
    onDetail?: (hasModal: boolean) => void;
  } = $props();

  const storage = getStorage();

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
  // the pool helpers — the same language the formula editor uses. The config's
  // variables join in: constants by value, state variables by live value.
  const baseScope = $derived(
    ruleScope(device.controls ?? [], getVirtualPool(), variableExtras()),
  );

  /** Variables as scope extras for this tile's rules. */
  function variableExtras(): VariableScope {
    return variableScope(
      getVariables(),
      (id) => (ioBroker.states as Map<string, any>)?.get?.(id)?.val,
    );
  }

  /** A stored source as the id the broker carries: a variable name resolves
   *  to the state behind it, anything else passes through. */
  function sourceId(source: string): string {
    return stateIdFor(source, getVariables());
  }

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

  /**
   * A raw state id as a read-only pseudo-control (A21): a slot may name any state
   * the document carries, not only a control of this device. Only the state's
   * own object makes it one — a feature name like "power" is not a state.
   */
  function rawControl(source: string): SlotControl | undefined {
    const id = sourceId(source);
    const obj = (ioBroker.objects as Map<string, any>)?.get?.(id);
    if (!obj) return undefined;
    const state = (ioBroker.states as Map<string, any>)?.get?.(id);
    return {
      id,
      stateId: id,
      label: obj.common?.name ?? id,
      unit: obj.common?.unit,
      liveValue: state?.val,
      writable: false,
    };
  }

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
        return pick(sourceId(source)); // a raw state id, or a variable
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

  /**
   * Everything the tile resolves, in one call (A46/A47): the body, the chart
   * layer, the modal's rows and badges, and whether the modal exists at all.
   * The sheet asks the same helper, so "does this tile have a detail page?"
   * cannot drift from what the tile actually shows.
   */
  const parts = $derived(
    tileParts(device, tile, getTemplateRegistry().templates, {
      active,
      raw: rawControl,
      pool: getVirtualPool(),
      time: clock,
    }),
  );

  // The slots the resolution ran on (A18/A46): the tile's own once materialised,
  // the chain's until then — and the very objects the rows carry, so the
  // headline pick (A52) is a reference.
  const slots = $derived(parts.slots);

  // The accent the tile wears (A52): the headline slot's resolved style. The
  // *style* carries, so "glow when on" keeps working with the icon disabled;
  // the values reach CSS through custom properties (spec §6).
  const headline = $derived(headlineSlot(slots));
  const accent = $derived(headline ?? { kind: "value" as const });
  const tileStyle = $derived(slotStyle(accent, controlFor(accent)));
  // What the tile's own active state says (A71). A field set here wins over the
  // rules for that state; an absent field keeps what the rules resolved.
  const look = $derived(stateLook(tile, active));
  const accentColor = $derived(look.color ?? tileStyle.color);
  // A glow colour of its own turns the glow on, whatever the rules said (A71).
  const glowing = $derived(look.glow !== undefined || tileStyle.glow === true);
  // The tile's own painted background first (A33): a rule's background is
  // appended after it, so the live condition still wins; the state look last.
  const tileVars = $derived(
    `${backgroundCss(tile?.background)} --tile-accent: ${
      accentColor ?? "transparent"
    }; --tile-glow-color: ${
      look.glow ?? accentColor ?? "transparent"
    }; --tile-glow: ${glowing ? 1 : 0};${
      tileStyle.background ? ` background-color: ${tileStyle.background};` : ""
    }${look.background ? ` ${backgroundCss(look.background)}` : ""}`,
  );

  const chart = $derived(tileSeries(parts.rows));
  const bodySlots = $derived(parts.body);

  /** The body-row icon (A51/A53): the headline's is the big glyph, the rest read small.
   *  A tile that draws a chart blends its big glyph out whatever the state says
   *  (a reading with history is usually not a switch), so the line reads over it.
   *  The active state's look (A71) speaks over the rules, field by field. */
  function bodyIcon(r: SlotRow) {
    const main = r.slot === headline;
    const lk = main ? look : {};
    // A look glyph may stand where the descriptor had none, but an icon turned
    // off — or homed away from the tile — stays off.
    if (r.slot.icon?.enabled === false) return undefined;
    const where = r.slot.icon?.where ?? "both";
    if (where !== "both" && where !== "tile") return undefined;
    const icon = rowIcon(r, "tile", device.objectIcon);
    const glyph = lk.glyph ?? icon?.glyph;
    if (!glyph) return undefined;
    return {
      glyph,
      color: lk.color ?? icon?.color,
      size: main ? 34 : 17,
      disabled: icon?.disabled === true || (main && chart.length > 0),
    };
  }

  /** The band the chart occupies: the big glyph's box plus 2 px each way, so the
   *  line sits on the icon rather than in a strip of its own. Measured, because
   *  the name line and the rows above it move the glyph; falls back to the tile's
   *  middle 70% when the headline shows no icon. */
  // shortcut: re-measures only when the tile or the glyph resizes; a name that
  // wraps without resizing the tile leaves the band a line off until then.
  let tileEl = $state<HTMLElement>();
  let band = $state<{ top: number; height: number }>();

  $effect(() => {
    const el = tileEl;
    if (!el || !chart.length) {
      band = undefined;
      return;
    }
    let watched: HTMLElement | null = null;
    const measure = () => {
      const glyph = el.querySelector<HTMLElement>(
        "[data-chart-anchor] .slot-icon",
      );
      if (glyph && glyph !== watched) {
        watched = glyph;
        ro.observe(glyph);
      }
      if (!glyph) {
        band = undefined;
        return;
      }
      const t = el.getBoundingClientRect();
      const g = glyph.getBoundingClientRect();
      // `top` is measured from the padding box, so the tile's border comes off.
      const border = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
      band = { top: g.top - t.top - border - 2, height: g.height + 4 };
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });

  // The detail page's face (A54): the headline's icon follows its own
  // descriptor and homes. The header deliberately does not consult the row's
  // visibility — a conditionally hidden headline still greets its own page.
  const headIcon = $derived.by(() => {
    // A54: the headline's own icon greets the name…
    const own = headline
      ? rowIcon(
          {
            slot: headline,
            style: slotStyle(headline, controlFor(headline)),
          },
          "modal",
          device.objectIcon,
        )
      : undefined;
    if (own) return own;
    // …else the device's own face (A67): the icon its objects carry.
    return device.objectIcon ? { glyph: device.objectIcon } : undefined;
  });

  // What the sheet's Detail Page checkbox asks about (A47): the tile's own
  // resolution, not a second guess at the slots.
  $effect(() => {
    onDetail?.(parts.hasModal);
  });

  /** The tile's first reading is the headline; the rest are supporting. The row
   *  itself is the identity (A35): two identical slots are legal config and must
   *  render side by side, only the first of them as the headline. */
  const mainValueRow = $derived(bodySlots.find((r) => r.slot.kind === "value"));
  const badgeSlots = $derived(parts.badgeSlots);
  const modalBadges = $derived(parts.modalBadges);
  const modalRows = $derived(
    parts.modal.map((r) => ({
      slot: r.slot,
      control: r.control,
      style: r.style,
      icon: rowIcon(r, "modal", device.objectIcon),
      // The row's own chart (A62): part of the row, so it follows the row.
      spark: rowSpark(parts.rows, r, "modal"),
      // The slot that *is* the tile's action stays a button in the modal too.
      onPrimary: r.control && r.control === primary ? togglePrimary : undefined,
    })),
  );

  /** Something to enlarge into (A34): rows or badges. */
  const hasModal = $derived(parts.hasModal);

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
   * Open this tile's placement in the layout editor (A16). A gated entrance:
   * with the pencil lock on it asks for the PIN first. A tile rendered
   * without an anchor — an editor preview, say — falls back to the device
   * form (the devices page, the config side); the device shortcut was the
   * stopgap while no tile editor existed.
   */
  function openEditor() {
    if (anchor) {
      requestLayoutConfig(anchor);
      openSheetGated(pencilNeedsPin(storage.lockPencil, isUnlocked()));
      return;
    }
    requestDeviceConfig(device.id);
    void goto("#/devices");
  }

  function onCapture(event: MouseEvent) {
    if (!wantsDeviceConfig(event)) return;
    // Capture phase: the action buttons stopPropagation, so without this a
    // Ctrl+click on a light's icon would just switch the light.
    event.stopPropagation();
    event.preventDefault();
    openEditor();
  }

  /** Open the detail page, or ask for the tile's own PIN first. View mode only:
   *  a protected tile asks on every open — no session unlock — while the
   *  sheet's preview (the `openModal` prop below) never comes through here. */
  function openDetail(): void {
    if (tileNeedsPin(tile?.pin, hasModal)) askPin = true;
    else modalOpen = true;
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
    if (hasModal) openDetail();
  }

  let modalOpen = $state(false);
  let modalInline = $state(false);
  /** The tile's own PIN is being asked for (see `openDetail`). */
  let askPin = $state(false);

  // The sheet's "modal view": it asks this tile to open the modal it owns — the
  // real one, because only the tile resolves its rows. Withdrawing the ask
  // closes it again, so the sheet can keep this tile mounted and still untick
  // its box.
  $effect(() => {
    const ask = openModal;
    untrack(() => {
      if (!ask) {
        if (modalInline) {
          modalOpen = false;
          modalInline = false;
        }
        return;
      }
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
      openDetail();
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
  class:glow={glowing}
  class:disabled={tileStyle.disabled === true}
  data-page-id={anchor?.pageId}
  data-section-id={anchor?.sectionId}
  data-placement-id={anchor?.placementId}
  style="grid-column: {newLine
    ? '1'
    : 'auto'} / span {span.w}; grid-row: span {span.h}; {tileVars}"
  class:interactive={hasModal}
  bind:this={tileEl}
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
  {#if chart.length}
    <div
      class="tile-bg"
      style:--chart-top={band ? `${band.top}px` : undefined}
      style:--chart-height={band ? `${band.height}px` : undefined}
    >
      <TileChart series={chart} />
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
        icon={bodyIcon(r)}
        anchor={r.slot === headline}
        stack={r.slot === headline && span.w < 2}
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

{#if modalOpen}
  <TileModal
    {device}
    {title}
    background={tile?.background}
    rows={modalRows}
    badges={modalBadges}
    {headIcon}
    inline={modalInline}
    onClose={() => {
      modalOpen = false;
      onModalClose?.();
    }}
  />
{/if}

<!-- The tile's own lock (see `openDetail`): every open of a protected detail
     page asks again. -->
{#if askPin}
  <PinModal
    title={`Enter PIN for ${tileName}`}
    expected={tile?.pin}
    onSubmit={() => {
      askPin = false;
      modalOpen = true;
    }}
    onCancel={() => (askPin = false)}
  />
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
    box-shadow: 0 0 12px var(--tile-glow-color, var(--tile-accent));
    border-color: var(--tile-accent, var(--border-color));
  }

  /* Active (A30): the accent border only — glow stays rule territory. */
  .tile.active {
    border-color: var(--tile-accent, var(--primary-color));
  }

  /* The tile's chart (A61): the series of every value that charts here, drawn
     over the content — the icon (blended out while a chart draws) and values
     sit under it, so the line is never hidden. No pointer events; clipped to
     the tile's rounded box; the badges (z 2) stay on top. The band follows the
     headline glyph — its box plus 2 px each way — and falls back to the tile's
     middle 70% when no glyph anchors it. */
  .tile-bg {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--chart-top, 15%);
    height: var(--chart-height, 70%);
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
    z-index: 1;
    display: flex;
    align-items: center;
  }

  /* Stretch the chart across the band: the chart ships a fixed size for the
     in-body case, and a scoped style cannot reach into the child. */
  .tile-bg :global(.chart) {
    width: 100%;
    max-width: none;
    height: 100%;
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
