<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { backgroundCss } from "$lib/config/appearance";
  import {
    presetForType,
    primaryControl,
    resolveControl,
    tileActionControl,
  } from "$lib/config/template-ops";
  import { evalActive, withRolePair } from "$lib/config/tile-ops";
  import { defaultPair, effectiveDefault } from "$lib/config/icon-library";
  import { getIconPool } from "$lib/stores/icon-pool.svelte";
  import { resolveTile } from "$lib/config/tile-resolve";
  import { rawStateControl } from "$lib/config/state-meta";
  import { resolveSlotSource, type SourceLook } from "$lib/config/slot-source";
  import {
    faceGlyph,
    faceSwitchRow,
    headerIcon,
    tileHeadlineSlot,
    rowIcon,
    rowSpark,
    singleSurface,
    stateLook,
    tileParts,
    tileSeries,
    type SlotRow,
  } from "$lib/config/tile-parts";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { devicesEnrichedStore, getVirtualPool } from "$lib/stores/devices";
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
  import {
    clampSpan,
    tileColumns,
    type Breakpoint,
  } from "$lib/config/size-ops";
  import { requestLayoutConfig, wantsDeviceConfig } from "$lib/pages.js";
  import { openSheetGated } from "$lib/stores/sheet.svelte.js";
  import { tileNeedsPin } from "$lib/config/pin.svelte";
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
  import type { Rule, Slot, TileConfig, Placement } from "$lib/types/display";
  import type { PlacementAnchor } from "$lib/config/layout-ops";

  let {
    placement,
    bp,
    title,
    tile,
    anchor,
    newLine,
    limit = 0,
    openModal = null,
    onModalClose,
    onDetail,
  }: {
    /** The placement this tile is: its title and own config. */
    placement?: Placement;
    bp: Breakpoint;
    /** Preview overrides; absent → the placement's own. */
    title?: string;
    tile?: TileConfig;
    /** Where this tile sits on a page — what the display hands the editor (A16). */
    anchor?: PlacementAnchor;
    /** The tree asks for a line break before this tile. */
    newLine?: boolean;
    /** The section's column count, so a wide tile cannot leave its box when the
     *  1×1 module is scaled up; 0/absent → fluid (preview). */
    limit?: number;
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

  const sourceLook = $derived<SourceLook>({
    devices: $devicesEnrichedStore,
    states: ioBroker.states as Map<string, any>,
    objects: ioBroker.objects as Map<string, any>,
    variables: getVariables(),
  });
  const resolution = $derived(
    resolveTile(tile ?? placement?.tile, title ?? placement?.title, sourceLook),
  );
  /** The control bag derived from this tile's slots — never a device identity. */
  const device = $derived(resolution.device);
  const workingTile = $derived(resolution.tile);

  /** Hidden controls are not part of the tile at all. */
  const shownControls = $derived(
    (device.controls ?? []).filter((c) => !c.hidden),
  );

  const span = $derived(clampSpan(workingTile?.size ?? { w: 2, h: 2 }, bp));
  /** What the grid actually gives it — never more columns than the section has. */
  const columns = $derived(tileColumns(span.w, limit ?? 0));
  // The name the tile shows: its own, else the placement's — and nothing at all
  // when the placement says `""` (A41).
  const tileName = $derived(title ?? placement?.title ?? "");
  const primary = $derived(primaryControl(shownControls));
  /** What a body tap acts on when the tile has no detail page. */
  const actionControl = $derived(tileActionControl(shownControls));

  // Spec §4.1 + label fallback: feature → control id → state id → label.
  function controlFor(slot: Slot): EnrichedControl | undefined {
    if (typeof slot.source !== "string") return undefined;
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
  // source it names; no condition means never active.
  const activeCond = $derived(workingTile?.active);
  const activeResolved = $derived(
    activeCond?.source && typeof activeCond.source === "object"
      ? resolveSlotSource(activeCond.source, sourceLook)
      : undefined,
  );
  const activeSource = $derived(
    typeof activeCond?.source === "string" ? activeCond.source : undefined,
  );
  const activeControl = $derived(
    activeResolved ??
      (activeSource
        ? (resolveControl(shownControls, activeSource) ??
          rawControl(activeSource))
        : undefined),
  );
  const activeValue = $derived(
    activeResolved
      ? activeResolved.value
      : activeControl && "liveValue" in activeControl
        ? activeControl.liveValue
        : undefined,
  );
  const active = $derived(evalActive(activeCond, activeValue));
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
    return rawStateControl(id, obj, state?.val);
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
        const resolved = resolution.sources.get(source);
        if (resolved?.stateId) return pick(resolved.stateId);
        if (resolved?.stateIds?.length) {
          let latest: number | undefined;
          for (const id of resolved.stateIds) {
            const v = pick(id);
            if (typeof v === "number" && (latest === undefined || v > latest)) {
              latest = v;
            }
          }
          return latest;
        }
        const control = resolveControl(shownControls, source);
        if (control) return pick(control.stateId);
        return pick(sourceId(source)); // a raw state id, or a variable
      }
      let latest: number | undefined;
      for (const resolved of resolution.sources.values()) {
        const v = pick(resolved.stateId);
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
    tileParts(device, workingTile, getTemplateRegistry().templates, {
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
  const headline = $derived(tileHeadlineSlot(slots));
  /** The headline's reading, for an HTML icon's `{{$value}}` in the header. */
  const headValue = $derived(
    parts.rows.find((r) => r.slot === headline)?.control?.liveValue,
  );
  const accent = $derived(headline ?? { kind: "value" as const });
  const tileStyle = $derived(slotStyle(accent, controlFor(accent)));
  // The automatic pair: the tile/device template first, then the headline
  // control's exact ioBroker role, then its family. Auto defaults need the
  // pool before the first render; the root layout starts its load.
  const headlineControl = $derived(
    parts.rows.find((row) => row.slot === headline)?.control,
  );
  // resolveTile rewrites each source to a `slot:N` pseudo key; the original
  // placement's slot at the same index still names the device.
  const rawTile = $derived(tile ?? placement?.tile);
  const rawHeadlineSource = $derived(
    rawTile?.slots?.[slots.indexOf(headline)]?.source,
  );
  const sourceDevice = $derived.by(() => {
    const source = rawHeadlineSource;
    if (!source || typeof source === "string" || source.kind !== "control") {
      return undefined;
    }
    return $devicesEnrichedStore.find((entry) => entry.id === source.device);
  });
  const templateId = $derived(
    workingTile?.template ??
      sourceDevice?.template ??
      presetForType(sourceDevice?.type ?? device.type).id,
  );
  const poolPair = $derived(
    defaultPair(getIconPool(), templateId, headlineControl?.role),
  );
  // The device's own pair dresses a tile that carries no icon and no look of
  // its own. A pool default wins over an icon only derived from the objects —
  // the device document's icon is a deliberate choice and wins over both.
  const ownPair = $derived(
    device.objectIcon &&
      !workingTile?.look?.inactive?.glyph &&
      !workingTile?.look?.active?.glyph
      ? device.objectActiveIcon
        ? { value: device.objectIcon, activeValue: device.objectActiveIcon }
        : { value: device.objectIcon }
      : undefined,
  );
  const automaticPair = $derived(device.icon ? ownPair : (poolPair ?? ownPair));
  // What the tile's own active state says (A71). A field set here wins over the
  // rules for that state; an absent field keeps what the rules resolved.
  const look = $derived(
    stateLook(withRolePair(workingTile, automaticPair), active),
  );
  /** A pool default dresses the face without an active condition too; with one,
   *  the look pair already carries it. A device's own icon wins over it. */
  const poolFaceGlyph = $derived(!workingTile?.active ? poolPair?.value : undefined);
  const faceDefault = $derived(device.icon ? undefined : poolFaceGlyph);
  /** The role default for a row whose slot carries no icon; a rule icon and a
   *  slot icon still win inside `rowIcon`. */
  function roleDefault(control?: SlotControl): string | undefined {
    const role = control?.role ?? control?.meta?.role;
    return role ? effectiveDefault(getIconPool(), "roles", role) : undefined;
  }
  const accentColor = $derived(look.color ?? tileStyle.color);
  // A glow colour of its own turns the glow on, whatever the rules said (A71).
  const glowing = $derived(look.glow !== undefined || tileStyle.glow === true);
  // The tile's own painted background first (A33): a rule's background is
  // appended after it, so the live condition still wins; the state look last.
  const tileVars = $derived(
    `${backgroundCss(workingTile?.background)} --tile-accent: ${
      accentColor ?? "transparent"
    }; --tile-glow-color: ${
      look.glow ?? accentColor ?? "transparent"
    }; --tile-glow: ${glowing ? 1 : 0};${
      tileStyle.background ? ` background-color: ${tileStyle.background};` : ""
    }${look.background ? ` ${backgroundCss(look.background)}` : ""}`,
  );

  const chart = $derived(tileSeries(parts.rows));
  const bodySlots = $derived(parts.body);
  /** The face icon sits above the name; its reading stays with the other rows. */
  const headlineRow = $derived(bodySlots.find((r) => r.slot === headline));
  /** A detail-only headline still dresses the face; only its control is hidden. */
  const faceRow = $derived(
    headlineRow ?? parts.rows.find((row) => row.slot === headline),
  );
  const faceIcon = $derived(
    faceRow ? bodyIcon(faceRow, headlineRow ? "tile" : "modal") : undefined,
  );
  /** A switch/button shown on the tile drives the face even when its own slot
   *  icon is hidden there. A detail-only slot stays out (the PIN case). */
  const faceSwitch = $derived(faceSwitchRow(bodySlots, headlineRow));
  const faceAction = $derived.by(() => {
    if (!faceRow) return undefined;
    const control = faceSwitch?.control ?? headlineRow?.control;
    return control ? actionFor(control) : undefined;
  });
  const orderedBody = $derived(
    headlineRow
      ? [headlineRow, ...bodySlots.filter((r) => r !== headlineRow)]
      : bodySlots,
  );
  /** A lone frame/html slot is the whole face: no name, no padding. */
  const surfaceOnly = $derived(singleSurface(bodySlots.map((row) => row.slot)));
  /** Sparkline layout: a band after the name, or the whole tile face. */
  const chartConfig = $derived(workingTile?.chart);
  const chartFull = $derived(
    chartConfig?.full ?? chartConfig?.separate === true,
  );
  const chartHeight = $derived(chartConfig?.height ?? 56);
  const chartArea = $derived(chartConfig?.area === true);

  /** The icon a row shows: state Look → tile icon → the row's own icon →
   *  the device's face. The look/tile/device are tile-level and survive a
   *  disabled slot icon. */
  function rowGlyph(r: SlotRow, home: "tile" | "modal") {
    const main = r.slot === headline;
    const lk = main ? look : {};
    // The face keeps the look pair; a body row's icon follows its own state.
    const icon = rowIcon(
      r,
      home,
      device.objectIcon,
      main ? undefined : getIconPool().twins,
      main ? undefined : roleDefault(r.control),
    );
    const glyph = faceGlyph(
      lk,
      main ? workingTile?.icon : undefined,
      icon?.glyph,
      main ? faceDefault : undefined,
      main ? device.objectIcon : undefined,
    );
    if (!glyph) return undefined;
    return {
      glyph,
      color: lk.color ?? icon?.color,
      disabled: main ? (lk.disabled ?? icon?.disabled) : icon?.disabled,
    };
  }

  function bodyIcon(r: SlotRow, home: "tile" | "modal" = "tile") {
    const main = r.slot === headline;
    const icon = rowGlyph(r, home);
    if (!icon) return undefined;
    return {
      ...icon,
      size: main ? 46 : 22,
      disabled: icon.disabled === true,
    };
  }

  let tileEl = $state<HTMLElement>();

  // The detail page's face (A54): the headline's icon follows its own
  // descriptor and homes. The header deliberately does not consult the row's
  // visibility — a conditionally hidden headline still greets its own page.
  const headIcon = $derived.by(() => {
    // A54/A72: the tile's own icon, then its state look, then the headline's
    // icon, then the device's face (A67).
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
    // A54/A72: tile icon, state look, headline icon, pool default, device face
    // — the device's own icon beats the default only by making it absent.
    return (
      headerIcon(workingTile?.icon, look, own) ??
      (faceDefault ? { glyph: faceDefault } : undefined) ??
      (device.objectIcon ? { glyph: device.objectIcon } : undefined)
    );
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
      // The slot's own icon, not the tile's main/look icon: the headline row is
      // a line in the detail page, not the face.
      icon: rowIcon(
        r,
        "modal",
        device.objectIcon,
        getIconPool().twins,
        roleDefault(r.control),
      ),
      // The row's own chart (A62): part of the row, so it follows the row.
      spark: rowSpark(parts.rows, r, "modal"),
      // The slot that *is* the tile's action stays a button in the modal too.
      onPrimary: actionFor(r.control),
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

  /** Room a top/bottom badge row needs; it is absolute, so without it the
   *  name and readings draw underneath. Measured because a row can wrap. */
  let badgeHeights = $state({ top: 0, bottom: 0 });
  $effect(() => {
    // Re-query when the groups change; observe each row for wrapping.
    void badgeGroups;
    const el = tileEl;
    if (!el) return;
    const rows = [
      ...el.querySelectorAll<HTMLElement>(".badges.by-top"),
      ...el.querySelectorAll<HTMLElement>(".badges.by-bottom"),
    ];
    if (!rows.length) {
      const current = untrack(() => badgeHeights);
      if (current.top || current.bottom) badgeHeights = { top: 0, bottom: 0 };
      return;
    }
    const measure = () => {
      const height = (selector: string) =>
        Array.from(el.querySelectorAll<HTMLElement>(selector)).reduce(
          (max, row) => Math.max(max, row.getBoundingClientRect().height),
          0,
        );
      const next = {
        top: height(".badges.by-top"),
        bottom: height(".badges.by-bottom"),
      };
      const current = untrack(() => badgeHeights);
      if (next.top !== current.top || next.bottom !== current.bottom) {
        badgeHeights = next;
      }
    };
    const ro = new ResizeObserver(measure);
    for (const row of rows) ro.observe(row);
    measure();
    return () => ro.disconnect();
  });
  // A row's height minus the 3px it hangs outside the border, plus a gap, minus
  // the base padding on that side (8px top, 6px bottom).
  const badgePadVars = $derived(
    `--badge-inset-top: ${badgeHeights.top ? Math.max(0, badgeHeights.top - 9) : 0}px; --badge-inset-bottom: ${badgeHeights.bottom ? Math.max(0, badgeHeights.bottom - 7) : 0}px;`,
  );

  /**
   * A slot's icon may be its action even when no device control exists: a tile
   * built from a raw state/variable has no device primary, but its switch or
   * button must still be operable by tapping the icon.
   */
  function actionFor(control: any): (() => void) | undefined {
    if (!control) return undefined;
    if (primary && control === primary) return togglePrimary;
    if (
      control.writable !== true ||
      (control.widget !== "switch" && control.widget !== "button")
    ) {
      return undefined;
    }
    return () => {
      const isButton = control.widget === "button";
      writeControl(
        ioBroker,
        control,
        isButton ? true : !truthy(control.liveValue),
        Date.now(),
        { lockMs: isButton ? 0 : 3000 },
      );
      if (isButton) {
        setTimeout(
          () => writeControl(ioBroker, control, false, Date.now()),
          300,
        );
      }
    };
  }

  /** A tap anywhere acts only when nothing opens a detail page (see onActivate). */
  const tileAction = $derived(
    actionControl ? actionFor(actionControl) : undefined,
  );

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
    }
    openSheetGated();
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
    if (tileNeedsPin(workingTile?.pin, hasModal)) askPin = true;
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
    // Body tap = enlarge (spec §7) when the tile has a detail page. With none,
    // the whole face acts: a switch toggles, a button presses. Before that the
    // action lived only on the icon/value, which left most of a button tile
    // inert.
    if (hasModal) openDetail();
    else tileAction?.();
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
  class:disabled={look.disabled ?? tileStyle.disabled === true}
  class:single-surface={surfaceOnly}
  class:no-border={workingTile?.border === false}
  class:no-padding={workingTile?.padding === false}
  data-page-id={anchor?.pageId}
  data-section-id={anchor?.sectionId}
  data-placement-id={anchor?.placementId}
  style="grid-column: {newLine
    ? '1'
    : 'auto'} / span {columns}; grid-row: span {span.h}; {tileVars}; {badgePadVars}"
  class:interactive={hasModal || !!tileAction}
  bind:this={tileEl}
  role={tileAction ? "button" : undefined}
  tabindex={tileAction ? 0 : undefined}
  onclickcapture={onCapture}
  onclick={onActivate}
  onkeydown={onKey}
  onpointerdown={onPointerDown}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  onpointerleave={cancelPress}
>
  {#if chartFull && chart.length}
    <div class="tile-chart-full">
      <TileChart
        series={chart}
        wide
        area={chartArea}
        decimals={chartConfig?.decimals}
      />
    </div>
  {/if}
  {#if faceRow && !surfaceOnly}
    {#if faceIcon}
      <SlotRenderer
        slot={faceRow.slot}
        {device}
        control={faceRow.control}
        style={faceRow.style}
        icon={faceIcon}
        onPrimary={faceAction}
        face
      />
    {/if}
  {/if}
  {#if tileName && !surfaceOnly}<span class="tile-name">{tileName}</span>{/if}
  {#if !chartFull && chart.length}
    <div class="tile-chart" style:--chart-height={`${chartHeight}px`}>
      <TileChart
        series={chart}
        wide
        area={chartArea}
        decimals={chartConfig?.decimals}
      />
    </div>
  {/if}
  <div class="tile-body">
    {#each orderedBody as r, i (i)}
      <SlotRenderer
        slot={r.slot}
        {device}
        control={r.control}
        style={slotStyle(r.slot, r.control)}
        icon={r === headlineRow ? undefined : bodyIcon(r)}
        single={surfaceOnly}
        onPrimary={actionFor(r.control)}
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
    title={tileName}
    background={workingTile?.background}
    rows={modalRows}
    badges={modalBadges}
    {headIcon}
    {headValue}
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
    expected={workingTile?.pin}
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
    /* The tile's text face is the user's choice; editors keep the UI face. */
    font-family: var(--ui-font-text, var(--font-family));
    /* Top-aligned, not centred: side-by-side tiles in a row then share their
       baselines instead of floating to different heights. */
    justify-content: flex-start;
    gap: 0.2rem;
    /* More air above and below the content, less at the sides; a top/bottom
       badge row adds its band so it never draws over the content. */
    padding: calc(8px + var(--badge-inset-top, 0px)) 2px
      calc(6px + var(--badge-inset-bottom, 0px));
    min-width: 0;
    /* No overflow clipping: a badge is allowed to sit on the tile's own edge. */
    text-align: center;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    /* A User Interface default (ui-settings.ts); an explicit tile background is
       inline and wins. */
    background-color: var(--ui-tile-bg, var(--surface-container-lowest));
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

  /* Look options: an explicit border/glow must not bring the edge back. */
  .tile.no-border,
  .tile.no-border.active,
  .tile.no-border.glow {
    border-color: transparent;
  }

  /* Removing the normal padding still leaves the badge band reserved. */
  .tile.no-padding {
    padding-top: var(--badge-inset-top, 0px);
    padding-right: 0;
    padding-bottom: var(--badge-inset-bottom, 0px);
    padding-left: 0;
  }

  /* Sparkline full: one layer across the tile's content area, behind the name,
     icon and rows. The content is lifted above it below. */
  .tile-chart-full {
    position: absolute;
    top: calc(8px + var(--badge-inset-top, 0px));
    bottom: calc(6px + var(--badge-inset-bottom, 0px));
    left: 2px;
    right: 2px;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
  }

  .tile-chart-full :global(.chart) {
    width: 100%;
    max-width: none;
    height: 100%;
  }

  .tile.no-padding .tile-chart-full {
    top: var(--badge-inset-top, 0px);
    right: 0;
    bottom: var(--badge-inset-bottom, 0px);
    left: 0;
  }

  .tile.single-surface .tile-chart-full {
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
  }

  /* The chart is a background: the face, name and rows paint over it. */
  .tile-name,
  .tile-body {
    position: relative;
    z-index: 1;
  }

  /* The default sparkline: its own band after the name, so the face icon and
     title stay together. The 5% side inset is the breathing room from the
     tile edge. */
  .tile-chart {
    display: flex;
    align-items: stretch;
    width: 100%;
    height: var(--chart-height, 56px);
    flex: 0 0 auto;
    padding-inline: 5%;
    box-sizing: border-box;
    overflow: hidden;
  }

  .tile-chart :global(.chart) {
    width: 100%;
    max-width: none;
    height: 100%;
  }

  .tile-name {
    font-size: var(--ui-name-size, 0.825rem);
    font-weight: 700;
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
    /* One pixel more than before: a slot icon must read as belonging to the
       slot below it, not the previous row. */
    gap: calc(0.15rem + 1px);
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

  /* A lone frame/html slot owns the whole face: the tile title would steal a
     line from the page and the padding would frame it twice. */
  .tile.single-surface {
    padding: 0;
    gap: 0;
    overflow: hidden;
  }

  .tile.single-surface .tile-body {
    gap: 0;
  }
</style>
