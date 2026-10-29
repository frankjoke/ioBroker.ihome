<script lang="ts">
  import { onMount } from "svelte";
  import { isHexColor } from "$lib/config/appearance";
  import {
    movePlacement,
    patchPage,
    patchPlacement,
    patchSection,
    type LayoutSelection,
    type PlacementAnchor,
  } from "$lib/config/layout-ops";
  import { resolveSection } from "$lib/config/pages-ops";
  import {
    BREAKPOINTS,
    SIZE_MAX,
    breakpointFor,
    type TileSpan,
  } from "$lib/config/size-ops";
  import { effectiveUi, scaledTile } from "$lib/config/ui-settings";
  import { getSettings } from "$lib/stores/settings.svelte";
  import { effectiveSpan, slotVisible } from "$lib/config/template-ops";
  import {
    addRule,
    clearRuleIcons,
    editTile,
    evalActive,
    moveRule,
    moveSlot,
    nextSlotWhere,
    patchIcon,
    patchRule,
    patchSlot,
    patchSpark,
    removeRule,
    removeSlot,
    setLook,
    setSlotSource,
    setSlotWhere,
    slotWhere,
  } from "$lib/config/tile-ops";
  import { hasHistory, headlineSlot } from "$lib/config/tile-parts";
  import { resolveTile } from "$lib/config/tile-resolve";
  import { resolveSlotSource, type SourceLook } from "$lib/config/slot-source";
  import { BADGE_COLORS, ruleScope } from "$lib/config/rule-ops";
  import { isValidPin } from "$lib/config/pin.svelte";
  import { evaluateVirtual } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import GroupSection from "$lib/components/display/GroupSection.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import BackgroundEditor from "$lib/components/common/BackgroundEditor.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import WhereButton from "$lib/components/layout/WhereButton.svelte";
  import StatePicker from "$lib/components/discovery/StatePicker.svelte";
  import { roomList, roomsOf as roomsOfEnum } from "$lib/config/rooms";
  import type {
    ActiveCondition,
    ActiveOp,
    Background,
    Group,
    PageRegistry,
    Placement,
    Rule,
    Size,
    Slot,
    SlotIcon,
    SlotKind,
    SlotSource,
    SlotSpark,
    StateLook,
    TileConfig,
  } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";
  import type { Snippet } from "svelte";

  let {
    registry,
    devices,
    selection,
    onChange,
    onSelect,
    onAddSlot,
    hasDetail = false,
    detailShown = false,
    onDetailToggle,
  }: {
    registry: PageRegistry;
    devices: EnrichedDevice[];
    selection: LayoutSelection;
    onChange: (next: PageRegistry) => void;
    /** Move-to-section hands the pane to the tile's new address. */
    onSelect?: (selection: LayoutSelection) => void;
    /** Add slot: the route owns the picker. `at` inserts there instead of
     * appending (the list-end `+`). */
    onAddSlot?: (anchor: PlacementAnchor, at?: number) => void;
    /** The sheet's detail-page preview: whether this tile has one (A47), and
     *  whether it is shown over the display right now. The sheet owns the
     *  preview tile — this pane only draws the line's controls. */
    hasDetail?: boolean;
    detailShown?: boolean;
    onDetailToggle?: (shown: boolean) => void;
  } = $props();

  // The preview renders at the real breakpoint, so what you see is what the
  // display will make of it.
  let width = $state(1400);
  onMount(() => {
    const onResize = () => (width = window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
  /** Which icon field the picker is open for, if any. */
  let iconPicker = $state<null | "page" | "section">(null);
  /** The source picker for the tile's active condition. */
  let activePicker = $state(false);
  /** Slot UI: which row is expanded, which rules block is open, pickers. */
  let expandedSlot = $state<number | null>(null);
  let openRules = $state<number | null>(null);
  let sourcePickerFor = $state<number | null>(null);
  let ruleIconFor = $state<{ slot: number; rule: number } | null>(null);
  /** The slot icon's own picker (A57). */
  let iconPickerFor = $state<number | null>(null);
  /** The active look's glyph picker (A71). */
  let lookIconFor = $state<"active" | "inactive" | null>(null);
  const bp = $derived(breakpointFor(width));
  const def = $derived(
    BREAKPOINTS.find((b) => b.name === bp) ?? BREAKPOINTS[0],
  );
  /** The preview shows the display's real module, scale included. */
  const previewModule = $derived(
    scaledTile(def, effectiveUi(getSettings()).tileScale),
  );

  const page = $derived(registry.pages.find((p) => p.id === selection.pageId));
  const section = $derived(
    selection.kind === "page"
      ? undefined
      : page?.groups.find((g) => g.id === selection.sectionId),
  );
  const tile = $derived(
    selection.kind === "tile"
      ? (section?.tiles ?? []).find((t) => t.id === selection.placementId)
      : undefined,
  );
  const sourceLook = $derived<SourceLook>({
    devices,
    states: (ioBroker.states ?? new Map()) as Map<string, any>,
    objects: (ioBroker.objects ?? new Map()) as Map<string, any>,
  });
  /** The tile's synthetic control bag: what its slots read, nothing more. */
  const device = $derived(
    resolveTile(tile?.tile, tile?.title, sourceLook).device,
  );

  /** The device state picker's room filters, as on the Devices page. */
  const rooms = $derived(roomList(ioBroker.enums));
  const roomsOf = (id: string) => roomsOfEnum(ioBroker.enums, id);

  const activeCond = $derived(tile?.tile?.active);
  const activeResolved = $derived(
    activeCond?.source && typeof activeCond.source === "object"
      ? resolveSlotSource(activeCond.source, sourceLook)
      : undefined,
  );
  const activeSource = $derived(
    typeof activeCond?.source === "string" ? activeCond.source : undefined,
  );
  const activeFound = $derived(
    !activeCond?.source ||
      (activeResolved ? activeResolved.available !== false : false) ||
      !!sourceLook.objects.get(activeSource ?? ""),
  );
  const activeValue = $derived(
    activeResolved
      ? activeResolved.value
      : (ioBroker.states as Map<string, any>)?.get?.(activeSource ?? "")?.val,
  );
  const readingText = $derived.by(() => {
    const raw = activeValue;
    if (raw === undefined || raw === null) return "—";
    return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  });

  const OPS: { op: ActiveOp; label: string }[] = [
    { op: "truthy", label: "on / truthy" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
    { op: "eq", label: "=" },
    { op: "ne", label: "≠" },
  ];

  /** The rows the pane lists: the tile's own slots (v2: always these). */
  const shownSlots = $derived(tile?.tile?.slots ?? []);

  /** The states the look block edits (A71): the inactive one is also the
   *  tile's default, so a tile with no active condition edits just that. */
  const lookStates = $derived(
    activeCond ? (["active", "inactive"] as const) : (["inactive"] as const),
  );

  /** What the headline icon shows while the look sets no glyph (A67). */
  const defaultGlyph = $derived(headlineSlot(shownSlots)?.icon?.glyph);

  /** How many of them still live on the tile — the guard for A34. */
  const tileVisibleCount = $derived(
    shownSlots.filter((s) => slotWhere(s) !== "modal").length,
  );

  /** The tile's active reading, and the scope the rules' live dots evaluate in. */
  const tileActive = $derived(evalActive(activeCond, activeValue));
  const scope = $derived.by(() => {
    if (!device) return undefined;
    const base = ruleScope(device.controls ?? [], getVirtualPool());
    return { ...base, locals: { ...base.locals, active: tileActive } };
  });

  const KIND_GLYPH: Record<SlotKind, string> = {
    value: "numbers",
    switch: "toggle_on",
    level: "tune",
    color: "palette",
    enum: "list",
    button: "smart_button",
    badge: "label",
    "history-list": "history",
    frame: "web_asset",
  };

  /** The kinds the Icon block is offered on (A57) — data-bearing slots, not
   *  badges, frames or charts. The renderer stays generic: it draws any
   *  descriptor a document carries. */
  const ICON_KINDS: SlotKind[] = ["value", "level", "color", "enum", "button"];

  /** The three homes a slot can have (A34), in click order, and their icons. */
  const WHERE_GLYPH = {
    tile: "crop_square",
    both: "splitscreen",
    modal: "open_in_full",
  } as const;
  const WHERE_LABEL = {
    tile: "tile",
    both: "tile + modal",
    modal: "modal only",
  } as const;

  /** The three visibility states (A30), in click order, and their icons. */
  const SHOW_GLYPH = {
    both: "all_inclusive",
    active: "toggle_on",
    inactive: "toggle_off",
  } as const;
  const SHOW_LABEL = {
    both: "always",
    active: "active only",
    inactive: "inactive only",
  } as const;

  function nextShow(slot: Slot): "both" | "active" | "inactive" {
    const cur = slot.showWhen ?? "both";
    return cur === "both" ? "active" : cur === "active" ? "inactive" : "both";
  }

  function cycleWhere(i: number, slot: Slot): void {
    edit((t) => setSlotWhere(t, i, nextSlotWhere(slot, tileVisibleCount)));
  }

  function cycleShowWhen(i: number, slot: Slot): void {
    const next = nextShow(slot);
    edit((t) =>
      patchSlot(t, i, { showWhen: next === "both" ? undefined : next }),
    );
  }

  /** What a click does, said in full — the guard included when it skips modal. */
  function whereTitle(slot: Slot): string {
    const cur = slotWhere(slot);
    const next = nextSlotWhere(slot, tileVisibleCount);
    const base = `Lives in: ${WHERE_LABEL[cur]} — click for ${WHERE_LABEL[next]}`;
    return cur === "both" && next === "tile"
      ? `${base} (one slot must stay on the tile)`
      : base;
  }

  function showTitle(slot: Slot): string {
    const cur = slot.showWhen ?? "both";
    return `Shown: ${SHOW_LABEL[cur]} — click for ${SHOW_LABEL[nextShow(slot)]}`;
  }

  // The preview resolves through the display's own resolver.

  /** Page fields: an empty value removes the property. */
  function setPage(
    patch: Partial<{
      title: string;
      icon: string;
      background: Background | undefined;
    }>,
  ): void {
    if (!page) return;
    const next: Record<string, unknown> = {};
    if ("title" in patch) next.title = patch.title?.trim() || undefined;
    if ("icon" in patch) next.icon = patch.icon?.trim() || undefined;
    if ("background" in patch) next.background = patch.background;
    onChange(patchPage(registry, page.id, next));
  }

  /**
   * Section fields. `appearance` is rebuilt field by field so clearing the last
   * one removes the object instead of leaving `{}` behind.
   */
  function setSection(
    patch: Partial<{
      title: string;
      icon: string;
      border: boolean;
      newLine: boolean;
      background: Background | undefined;
    }>,
  ): void {
    if (!page || !section) return;
    const next: Partial<Group> = {};
    if ("title" in patch) next.title = patch.title?.trim() || undefined;
    if ("icon" in patch) next.icon = patch.icon?.trim() || undefined;
    if ("newLine" in patch) next.newLine = patch.newLine ? true : undefined;
    if ("border" in patch || "background" in patch) {
      const appearance = { ...(section.appearance ?? {}) };
      if ("border" in patch) {
        appearance.border = patch.border ? true : undefined;
      }
      if ("background" in patch) appearance.background = patch.background;
      next.appearance = Object.values(appearance).some((v) => v !== undefined)
        ? appearance
        : undefined;
    }
    onChange(patchSection(registry, page.id, section.id, next));
  }

  /** Placement fields that are not the tile's own config (title, newLine). */
  function setTile(patch: Partial<Placement>): void {
    if (!page || !section || !tile) return;
    onChange(patchPlacement(registry, page.id, section.id, tile.id, patch));
  }

  /** The pane's one way to edit the tile's own config: materialise, then `fn`. */
  function edit(fn: (tile: TileConfig) => TileConfig): void {
    if (!page || !section || !tile) return;
    onChange(
      editTile(
        registry,
        { pageId: page.id, sectionId: section.id, placementId: tile.id },
        fn,
      ),
    );
  }

  /** This tile's address, or null when the selection drifted (deleted tile). */
  function anchor(): PlacementAnchor | null {
    if (!page || !section || !tile) return null;
    return { pageId: page.id, sectionId: section.id, placementId: tile.id };
  }

  /** The detail page's PIN: the field shows a draft, and only an empty or
   *  valid draft is written — a half-typed PIN must not disarm the lock, and
   *  must not be committed to the document either. */
  let pinDraft = $state("");
  let pinShown = $state(false);
  let pinDraftFor: string | null = null;
  // The draft belongs to one tile: selecting another re-seeds it from that
  // tile's stored PIN. Commits do not (they land on the same value).
  $effect(() => {
    const id = selection.kind === "tile" ? selection.placementId : null;
    if (id === pinDraftFor) return;
    pinDraftFor = id;
    pinShown = false;
    pinDraft = tile?.tile?.pin ?? "";
  });

  const pinInvalid = $derived(pinDraft !== "" && !isValidPin(pinDraft));

  function setPin(raw: string): void {
    pinDraft = raw;
    if (raw === "") edit((t) => ({ ...t, pin: undefined }));
    else if (isValidPin(raw)) edit((t) => ({ ...t, pin: raw }));
  }

  /**
   * The size the tile actually renders at: its placement's own size when set,
   * else its template's — the same calculation the display and the section pass
   * use. The fields must never show (or write back) a size other than this, or
   * editing one axis silently changes the other.
   */
  function effectiveTileSpan(): TileSpan {
    if (!tile) return { w: 1, h: 1 };
    return effectiveSpan(tile.tile, bp);
  }

  function setSize(axis: "w" | "h", raw: string): void {
    const value = Math.trunc(Number(raw));
    if (!Number.isFinite(value) || value < 1) return;
    // The document keeps the hint as typed, bounded by SIZE_MAX (A2); each
    // breakpoint clamps it to what it can show while rendering.
    const size = { ...effectiveTileSpan() } as Size;
    size[axis] = Math.min(value, SIZE_MAX) as Size["w"];
    edit((t) => ({ ...t, size }));
  }

  function setActiveSource(source: SlotSource | string): void {
    activePicker = false;
    edit((t) => ({
      ...t,
      active: { ...(t.active ?? { op: "truthy" as const }), source },
    }));
  }

  function setActiveOp(op: ActiveOp): void {
    edit((t) => {
      if (!t.active) return t;
      const active: ActiveCondition = { ...t.active, op };
      if (op === "truthy") delete active.value;
      return { ...t, active };
    });
  }

  function setActiveValue(value: string): void {
    edit((t) => (t.active ? { ...t, active: { ...t.active, value } } : t));
  }

  function clearActive(): void {
    edit((t) => ({ ...t, active: undefined }));
  }

  /** One state's look field (A71): `undefined` clears it. */
  function patchLook(
    state: "active" | "inactive",
    patch: Partial<StateLook>,
  ): void {
    edit((t) => setLook(t, state, patch));
  }

  /** Appends the placement to the chosen section, then the pane follows it. */
  function moveTileTo(key: string): void {
    const a = anchor();
    if (!a || !section) return;
    const at = (section.tiles ?? []).findIndex((t) => t.id === a.placementId);
    if (at < 0) return;
    const [pageId, sectionId] = key.split("|");
    const target = registry.pages
      .find((p) => p.id === pageId)
      ?.groups.find((g) => g.id === sectionId);
    if (!target) return;
    onChange(
      movePlacement(
        registry,
        { pageId: a.pageId, sectionId: a.sectionId, index: at },
        { pageId, sectionId, index: (target.tiles ?? []).length },
      ),
    );
    onSelect?.({ kind: "tile", pageId, sectionId, placementId: a.placementId });
  }

  // ------------------------------------------------------------------- slots

  /**
   * A source's own label, for the active-condition line: `Device.Control`,
   * a state id, or a device name (v2 sources are objects).
   */
  function sourceLabel(source: SlotSource | string): string {
    return slotLabel({ kind: "value", source });
  }

  /**
   * What a slot row shows next to its kind: `Device.Control` for a control
   * reference, the state id for a raw state, the URL for a frame (S3).
   */
  function slotLabel(slot: Slot): string {
    if (slot.kind === "frame") {
      return String(slot.options?.url ?? "") || "no page";
    }
    const source = slot.source;
    if (!source) return "no source";
    if (typeof source === "string") return source; // legacy v1 source
    if (source.kind === "state") return source.stateId;
    const device = devices.find((d) => d.id === source.device);
    if (source.kind === "device") return device?.name || source.device;
    const control = device?.controls?.find((c) => c.id === source.control);
    const name = control?.label || control?.feature || source.control;
    return device ? `${device.name || device.id}.${name}` : name;
  }

  /**
   * A source that resolves to nothing is dormant on the display, so the pane
   * marks it and offers to bind it. A control that merely is offline is not
   * dormant: it exists, its state is just unavailable right now.
   */
  function slotUnresolved(slot: Slot): boolean {
    if (slot.kind === "frame") return false;
    const source = slot.source;
    if (!source) return true;
    if (typeof source === "string") {
      return (
        !devices.some((d) =>
          (d.controls ?? []).some(
            (c) =>
              c.feature === source || c.id === source || c.stateId === source,
          ),
        ) && !sourceLook.objects.get(source)
      );
    }
    if (source.kind === "state") return !sourceLook.objects.get(source.stateId);
    if (source.kind === "device") {
      return !devices.some((d) => d.id === source.device);
    }
    return !devices
      .find((d) => d.id === source.device)
      ?.controls?.some((c) => c.id === source.control);
  }

  /** A rule's live dot: green when `when` evaluates to true, red on error. */
  function ruleDot(when: string): "true" | "error" | "idle" {
    if (!when.trim() || !scope) return "idle";
    const result = evaluateVirtual(when, scope);
    if (result.error) return "error";
    return result.value === true ? "true" : "idle";
  }

  /** A number input's reading; an empty field removes the option. */
  function num(raw: string): number | undefined {
    const text = raw.trim();
    if (!text) return undefined;
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  }

  /** The level readout's homes; a detail home needs the slot in the modal. */
  function setValueWhere(
    i: number,
    where: "tile" | "both" | "modal" | undefined,
  ): void {
    edit((t) => {
      const slot = (t.slots ?? [])[i];
      if (!slot) return t;
      const options = { ...(slot.options ?? {}) };
      if (where === undefined) delete options.valueWhere;
      else options.valueWhere = where;
      let next = patchSlot(t, i, { options });
      if (where && where !== "tile" && slotWhere(slot) === "tile") {
        next = setSlotWhere(next, i, "both");
      }
      return next;
    });
  }

  /** The level readout's three homes, in click order. */
  function valueWhereOf(slot: Slot): "tile" | "both" | "modal" {
    return slot.options?.valueWhere === "tile" ||
      slot.options?.valueWhere === "modal"
      ? slot.options.valueWhere
      : "both";
  }

  function nextValueWhere(slot: Slot): "tile" | "both" | "modal" {
    const cur = valueWhereOf(slot);
    return cur === "tile" ? "both" : cur === "both" ? "modal" : "tile";
  }

  function valueWhereTitle(slot: Slot): string {
    return `Value shows: ${WHERE_LABEL[valueWhereOf(slot)]} — click for ${
      WHERE_LABEL[nextValueWhere(slot)]
    }`;
  }

  function cycleValueWhere(i: number, slot: Slot): void {
    const next = nextValueWhere(slot);
    setValueWhere(i, next === "both" ? undefined : next);
  }

  function patchOptions(
    slotIndex: number,
    patch: Record<string, unknown>,
  ): void {
    edit((t) => {
      const slot = (t.slots ?? [])[slotIndex];
      if (!slot) return t;
      const options: Record<string, unknown> = {
        ...(slot.options ?? {}),
        ...patch,
      };
      for (const key of Object.keys(options)) {
        if (options[key] === undefined) delete options[key];
      }
      return patchSlot(t, slotIndex, {
        options: Object.keys(options).length ? options : undefined,
      });
    });
  }

  function setIcon(i: number, patch: Partial<SlotIcon>): void {
    edit((t) => patchIcon(t, i, patch));
  }

  function setSpark(i: number, patch: Partial<SlotSpark>): void {
    edit((t) => patchSpark(t, i, patch));
  }

  /** The chart's homes cycle both → tile → modal → both (A59). Its own home is
   *  independent of the slot's (A60), so no choice is ever skipped. */
  function nextSparkWhere(i: number): "tile" | "both" | "modal" {
    const cur = shownSlots[i]?.spark?.where ?? "both";
    return cur === "both" ? "tile" : cur === "tile" ? "modal" : "both";
  }

  function sparkWhereTitle(i: number): string {
    const cur = shownSlots[i]?.spark?.where ?? "both";
    return `Chart shows: ${WHERE_LABEL[cur]} — click for ${
      WHERE_LABEL[nextSparkWhere(i)]
    }`;
  }

  /** Does this slot's reading carry history (A63)? Drives the hint and the
   *  disabled toggle. */
  function sparkReady(i: number): boolean {
    const source = shownSlots[i]?.source;
    if (!source) return false;
    if (typeof source === "string") {
      return hasHistory(
        devices
          .flatMap((d) => d.controls ?? [])
          .find(
            (c) =>
              c.feature === source || c.id === source || c.stateId === source,
          ),
      );
    }
    if (source.kind !== "control") return false;
    return hasHistory(
      devices
        .find((d) => d.id === source.device)
        ?.controls?.find((c) => c.id === source.control),
    );
  }

  /** The colour select's value: "" (auto), a palette token, or "custom". */
  function sparkColorValue(slot: Slot): string {
    const color = slot.spark?.color;
    if (!color) return "";
    return Object.values(BADGE_COLORS).includes(color) ? color : "custom";
  }

  /** The icon's homes cycle both → tile → modal → both (A57); a modal-only
   *  slot has no tile to show on, so "tile" is skipped for it. */
  function nextIconWhere(i: number): "tile" | "both" | "modal" {
    const slot = shownSlots[i];
    const cur = slot?.icon?.where ?? "both";
    const next = cur === "both" ? "tile" : cur === "tile" ? "modal" : "both";
    return next === "tile" && slot && slotWhere(slot) === "modal"
      ? "modal"
      : next;
  }

  function iconWhereTitle(i: number): string {
    const cur = shownSlots[i]?.icon?.where ?? "both";
    return `Icon shows: ${WHERE_LABEL[cur]} — click for ${
      WHERE_LABEL[nextIconWhere(i)]
    }`;
  }

  function removeSlotAt(slotIndex: number): void {
    edit((t) => removeSlot(t, slotIndex));
    if (expandedSlot === slotIndex) expandedSlot = null;
    if (openRules === slotIndex) openRules = null;
  }

  function requestAddSlot(at?: number): void {
    const a = anchor();
    if (a) onAddSlot?.(a, at);
  }
</script>

{#snippet lookColor(
  label: string,
  value: string | undefined,
  aria: string,
  set: (v: string | undefined) => void,
)}
  <label class="small">
    <span class="label-mono">{label}</span>
    <select
      value={isHexColor(value ?? "") ? "custom" : (value ?? "")}
      onchange={(e) => {
        const next = e.currentTarget.value;
        if (next === "custom") {
          if (!isHexColor(value ?? "")) set("#494bd6");
          return;
        }
        set(next || undefined);
      }}
    >
      <option value="">default</option>
      {#each Object.entries(BADGE_COLORS) as [name, token] (name)}
        <option value={token}>{name}</option>
      {/each}
      <option value="custom">custom…</option>
    </select>
    {#if isHexColor(value ?? "")}
      <input
        type="color"
        class="color-input"
        aria-label={aria}
        value={value ?? ""}
        oninput={(e) => set(e.currentTarget.value)}
      />
    {/if}
  </label>
{/snippet}

<div class="details">
  {#if page && selection.kind === "page"}
    <h3>{page.title || "Page"}</h3>
    <label class="field">
      <span class="label-mono">Title</span>
      <input
        type="text"
        value={page.title ?? ""}
        placeholder="Page title"
        oninput={(e) => setPage({ title: e.currentTarget.value })}
      />
    </label>
    <label class="field">
      <span class="label-mono">Icon</span>
      <div class="row">
        <input
          type="text"
          value={page.icon ?? ""}
          placeholder="material symbol, e.g. home"
          oninput={(e) => setPage({ icon: e.currentTarget.value })}
        />
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (iconPicker = "page")}>Choose…</button
        >
        {#if page.icon}<span class="glyph"
            ><Icon value={page.icon} size={20} /></span
          >{/if}
      </div>
    </label>
    <div class="field">
      <span class="label-mono">Background</span>
      <BackgroundEditor
        background={page.background}
        onChange={(bg) => setPage({ background: bg })}
      />
    </div>
  {:else if selection.kind === "section" && section}
    <h3>{section.title || "Section"}</h3>
    <label class="field">
      <span class="label-mono">Title</span>
      <input
        type="text"
        value={section.title ?? ""}
        placeholder="no title (header-less)"
        oninput={(e) => setSection({ title: e.currentTarget.value })}
      />
    </label>
    <label class="field">
      <span class="label-mono">Icon</span>
      <div class="row">
        <input
          type="text"
          value={section.icon ?? ""}
          placeholder="material symbol"
          oninput={(e) => setSection({ icon: e.currentTarget.value })}
        />
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (iconPicker = "section")}>Choose…</button
        >
        {#if section.icon}<span class="glyph"
            ><Icon value={section.icon} size={20} /></span
          >{/if}
      </div>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={section.appearance?.border === true}
        onchange={(e) => setSection({ border: e.currentTarget.checked })}
      />
      <span>Draw a border around this section</span>
    </label>
    <div class="field">
      <span class="label-mono">Background</span>
      <BackgroundEditor
        background={section.appearance?.background}
        onChange={(bg) => setSection({ background: bg })}
      />
    </div>

    <label class="check">
      <input
        type="checkbox"
        checked={section.newLine === true}
        onchange={(e) => setSection({ newLine: e.currentTarget.checked })}
      />
      <span>Start a new line before this section</span>
    </label>

    <div
      class="preview"
      style={`--tile-w: ${previewModule.w}px; --tile-h: ${previewModule.h}px;`}
    >
      <GroupSection
        group={section}
        tiles={resolveSection(section)}
        {bp}
        pageId={page?.id ?? ""}
      />
    </div>
  {:else if selection.kind === "tile" && tile}
    <h3>{tile.title || device?.name || "Tile"}</h3>
    <div class="field">
      <span class="label-mono">Tile title</span>
      <div class="row">
        <input
          type="text"
          value={tile.title ?? ""}
          placeholder={device?.name ?? "defaults to the device name"}
          disabled={tile.title === ""}
          oninput={(e) =>
            setTile({ title: e.currentTarget.value.trim() || undefined })}
        />
        <label
          class="check"
          title="Show no name on the tile — for a tile that is all chart. The sheet and the modal still name it."
        >
          <input
            type="checkbox"
            checked={tile.title === ""}
            onchange={(e) =>
              setTile({ title: e.currentTarget.checked ? "" : undefined })}
          />
          <span>no name</span>
        </label>
      </div>
    </div>
    <div class="field">
      <span class="label-mono">Size (modules)</span>
      <div class="row">
        {#each ["w", "h"] as axis (axis)}
          <label class="small">
            <span class="label-mono">{axis}</span>
            <input
              type="number"
              class="num-input"
              min="1"
              max={SIZE_MAX}
              step="1"
              aria-label={`Size ${axis}`}
              value={String(
                axis === "w" ? effectiveTileSpan().w : effectiveTileSpan().h,
              )}
              oninput={(e) => setSize(axis as "w" | "h", e.currentTarget.value)}
            />
          </label>
        {/each}
        <label class="check">
          <input
            type="checkbox"
            checked={tile.newLine === true}
            onchange={(e) => setTile({ newLine: e.currentTarget.checked })}
          />
          <span>New line start</span>
        </label>
      </div>
    </div>

    <div class="field">
      <span class="label-mono">Active when</span>
      <div class="row">
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (activePicker = true)}
        >
          {activeCond?.source ? sourceLabel(activeCond.source) : "not set"}
        </button>
        {#if activeCond}
          <select
            aria-label="Active operator"
            value={activeCond.op}
            onchange={(e) => setActiveOp(e.currentTarget.value as ActiveOp)}
          >
            {#each OPS as o (o.op)}
              <option value={o.op}>{o.label}</option>
            {/each}
          </select>
          {#if activeCond.op !== "truthy"}
            <input
              type="text"
              placeholder="value"
              value={activeCond.value ?? ""}
              oninput={(e) => setActiveValue(e.currentTarget.value)}
            />
          {/if}
          <span class="live text-muted"
            >{activeFound ? readingText : "source not found"}</span
          >
          <span class="row-actions end">
            <button
              type="button"
              class="icon-btn"
              title="Clear the active condition"
              aria-label="Clear the active condition"
              onclick={clearActive}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </span>
        {/if}
      </div>
    </div>

    <div class="field">
      <span class="label-mono">Look</span>
      {#if !activeCond}
        <p class="note text-muted">
          This tile's own values — with an active condition, these become its
          inactive state.
        </p>
      {/if}
      <div class="look">
        {#each lookStates as state (state)}
          {@const lk = tile?.tile?.look?.[state] ?? {}}
          <div class="look-block">
            <div class="look-state">
              <span class="look-name">{activeCond ? state : "default"}</span>
              <button
                type="button"
                class="btn btn-sm glyph-pick"
                title={lk.glyph
                  ? `Glyph: ${lk.glyph} — click to change`
                  : defaultGlyph
                    ? `Default glyph: ${defaultGlyph} — click to change`
                    : "Choose a glyph"}
                onclick={() => (lookIconFor = state)}
              >
                {#if lk.glyph}
                  <Icon value={lk.glyph} size={16} />
                {:else if defaultGlyph}
                  <span class="glyph-default"
                    ><Icon value={defaultGlyph} size={16} /></span
                  >
                {:else}
                  icon…
                {/if}
              </button>
              {@render lookColor("glow", lk.glow, `${state} glow colour`, (v) =>
                patchLook(state, { glow: v }),
              )}
              {@render lookColor(
                "icon",
                lk.color,
                `${state} icon colour`,
                (v) => patchLook(state, { color: v }),
              )}
            </div>
            <div
              class="look-bg"
              title="Tile Background"
              aria-label="Tile Background"
            >
              <span class="label-mono">BG</span>
              <div class="look-bg-body">
                <BackgroundEditor
                  background={lk.background ?? tile?.tile?.background}
                  onChange={(bg) => patchLook(state, { background: bg })}
                />
              </div>
            </div>
          </div>
        {/each}
      </div>
      <p class="note text-muted">
        A value set here wins over the rules for that state;
        <em>default</em> keeps the rules. Dimming still comes from the rules.
      </p>
    </div>

    <!-- The detail page's own line (A47): the eye shows the page itself over
         the display — the editor never asks for the PIN — and the field sets
         the PIN that guards it in view mode. Both are the detail page's own
         business, so both dim while the tile has none. -->
    <div class="field">
      <div class="row">
        <span class="label-mono">Detail page</span>
        <span class="row-actions">
          <button
            type="button"
            class="icon-btn"
            class:on={detailShown}
            title={hasDetail
              ? detailShown
                ? "Hide the detail page"
                : "Show the detail page over the display"
              : "Nothing of this tile lives in the detail page"}
            aria-label={detailShown
              ? "Hide the detail page"
              : "Show the detail page"}
            aria-pressed={detailShown}
            disabled={!hasDetail}
            onclick={() => onDetailToggle?.(!detailShown)}
          >
            <span class="material-symbols-outlined">visibility</span>
          </button>
        </span>
        <span class="label-mono pin-label">PIN</span>
        <input
          class="pin-input"
          type={pinShown ? "text" : "password"}
          inputmode="numeric"
          autocomplete="off"
          value={pinDraft}
          placeholder="no PIN"
          aria-label="Detail page PIN"
          title="Ask for this PIN before the detail page opens (view mode). Empty = no lock."
          disabled={!hasDetail}
          oninput={(e) => setPin(e.currentTarget.value)}
        />
        <span class="row-actions">
          <button
            type="button"
            class="icon-btn"
            title={pinShown ? "Hide the PIN" : "Show the PIN"}
            aria-label={pinShown ? "Hide the PIN" : "Show the PIN"}
            disabled={!hasDetail || pinDraft === ""}
            onclick={() => (pinShown = !pinShown)}
          >
            <span class="material-symbols-outlined"
              >{pinShown ? "visibility" : "visibility_off"}</span
            >
          </button>
          <button
            type="button"
            class="icon-btn"
            title="Clear the PIN — the detail page opens freely again"
            aria-label="Clear the PIN"
            disabled={!hasDetail || pinDraft === ""}
            onclick={() => setPin("")}
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </span>
      </div>
      {#if pinInvalid}
        <p class="note text-muted">4-6 digits, numbers only.</p>
      {/if}
    </div>

    <div class="field">
      <div class="row between">
        <span class="label-mono">Slots</span>
        <span class="row-actions">
          <button
            type="button"
            class="icon-btn"
            title="Add slot"
            aria-label="Add slot"
            onclick={() => requestAddSlot()}
          >
            <span class="material-symbols-outlined">add</span>
          </button>
        </span>
      </div>
      <div class="slot-list">
        {#each shownSlots as slot, i (i)}
          <div class="slot-row" class:not-now={!slotVisible(slot, tileActive)}>
            <div class="slot-line">
              <button
                type="button"
                class="slot-head"
                aria-expanded={expandedSlot === i}
                onclick={() => (expandedSlot = expandedSlot === i ? null : i)}
              >
                <Icon value={KIND_GLYPH[slot.kind]} size={17} />
                {#if slot.icon && slot.icon.enabled !== false && slot.icon.glyph}
                  <Icon value={slot.icon.glyph} size={15} />
                {/if}
                {#if slot.spark && slot.spark.enabled !== false}
                  <Icon value="show_chart" size={15} />
                {/if}
                <span class="slot-summary"
                  >{slot.kind} · {slotLabel(
                    slot,
                  )}{#if !slot.source && slot.options?.pick}<span
                      class="hint-mark text-muted">(hint)</span
                    >{/if}</span
                >
                {#if slot === headlineSlot(shownSlots)}
                  <span
                    class="hint-badge"
                    title="The tile's face: its icon is the big one, the detail header's and the accent's."
                    >headline</span
                  >
                {/if}
              </button>
              <span class="row-actions">
                <WhereButton
                  where={slotWhere(slot)}
                  title={whereTitle(slot)}
                  active={slotWhere(slot) !== "tile"}
                  onCycle={() => cycleWhere(i, slot)}
                />
                <button
                  type="button"
                  class="icon-btn"
                  class:on={!!slot.showWhen}
                  title={showTitle(slot)}
                  aria-label={showTitle(slot)}
                  onclick={() => cycleShowWhen(i, slot)}
                >
                  <span class="material-symbols-outlined"
                    >{SHOW_GLYPH[slot.showWhen ?? "both"]}</span
                  >
                </button>
                {#if i === 0}
                  <button
                    type="button"
                    class="icon-btn"
                    title="Add slot above"
                    aria-label="Add slot above"
                    onclick={() => requestAddSlot(0)}
                  >
                    <span class="material-symbols-outlined">add</span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="icon-btn"
                    title="Move up"
                    aria-label="Move slot up"
                    onclick={() => edit((t) => moveSlot(t, i, i - 1))}
                  >
                    <span class="material-symbols-outlined">arrow_upward</span>
                  </button>
                {/if}
                {#if i === shownSlots.length - 1}
                  <button
                    type="button"
                    class="icon-btn"
                    title="Add slot below"
                    aria-label="Add slot below"
                    onclick={() => requestAddSlot()}
                  >
                    <span class="material-symbols-outlined">add</span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="icon-btn"
                    title="Move down"
                    aria-label="Move slot down"
                    onclick={() => edit((t) => moveSlot(t, i, i + 1))}
                  >
                    <span class="material-symbols-outlined">arrow_downward</span
                    >
                  </button>
                {/if}
                <button
                  type="button"
                  class="icon-btn"
                  title={shownSlots.length <= 1
                    ? "One slot must stay — a tile is never empty"
                    : "Remove slot"}
                  aria-label="Remove slot"
                  disabled={shownSlots.length <= 1}
                  onclick={() => removeSlotAt(i)}
                >
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </span>
            </div>
            {#if slotUnresolved(slot)}
              <div class="slot-line">
                <span class="warn">not assigned — bind or remove</span>
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() => (sourcePickerFor = i)}>Bind…</button
                >
              </div>
            {/if}
            {#if !activeCond && slot.showWhen}
              <div class="slot-line">
                <span class="note text-muted"
                  >only when {slot.showWhen} — no active condition set</span
                >
              </div>
            {/if}
            {#if expandedSlot === i}
              <div class="slot-editor">
                <div class="row">
                  <label class="small">
                    <span class="label-mono">Kind</span>
                    <select
                      value={slot.kind}
                      onchange={(e) =>
                        edit((t) =>
                          patchSlot(t, i, {
                            kind: e.currentTarget.value as SlotKind,
                          }),
                        )}
                    >
                      {#each Object.keys(KIND_GLYPH) as k (k)}
                        <option value={k}>{k}</option>
                      {/each}
                    </select>
                  </label>
                  {#if slot.kind === "frame"}
                    <label class="small grow">
                      <span class="label-mono">URL</span>
                      <input
                        type="text"
                        placeholder="http://…/echarts/index.html?preset=…"
                        value={String(slot.options?.url ?? "")}
                        oninput={(e) =>
                          patchOptions(i, {
                            url: e.currentTarget.value.trim() || undefined,
                          })}
                      />
                    </label>
                    <label
                      class="check"
                      title="Presses fall through to the tile — its long-press opens the modal, and the page can no longer be clicked or scrolled."
                    >
                      <input
                        type="checkbox"
                        checked={slot.options?.inert === true}
                        onchange={(e) =>
                          patchOptions(i, {
                            inert: e.currentTarget.checked ? true : undefined,
                          })}
                      />
                      <span>ignore pointer</span>
                    </label>
                  {:else}
                    <div class="small grow">
                      <span class="label-mono">Source</span>
                      <button
                        type="button"
                        class="btn btn-sm source-pick"
                        title={slot.source
                          ? `Change source — now ${slotLabel(slot)}`
                          : "Choose a source"}
                        onclick={() => (sourcePickerFor = i)}
                      >
                        <Icon value="edit" size={15} />
                        <span class="source-name">{slotLabel(slot)}</span>
                      </button>
                    </div>
                  {/if}
                </div>
                <div class="row">
                  <label class="small grow">
                    <span class="label-mono">Label</span>
                    <input
                      type="text"
                      value={slot.label ?? ""}
                      oninput={(e) =>
                        edit((t) =>
                          patchSlot(t, i, {
                            label: e.currentTarget.value.trim() || undefined,
                          }),
                        )}
                    />
                  </label>
                  <label class="small">
                    <span class="label-mono">Unit</span>
                    <input
                      type="text"
                      class="unit-input"
                      value={slot.unit ?? ""}
                      oninput={(e) =>
                        edit((t) =>
                          patchSlot(t, i, {
                            unit: e.currentTarget.value.trim() || undefined,
                          }),
                        )}
                    />
                  </label>
                </div>
                {#if slot.kind !== "frame"}
                  <div class="row">
                    <label class="small grow">
                      <span class="label-mono">Hint</span>
                      <input
                        type="text"
                        placeholder="e.g. temperature"
                        value={String(slot.options?.pick ?? "")}
                        oninput={(e) =>
                          patchOptions(i, {
                            pick: e.currentTarget.value.trim() || undefined,
                          })}
                      />
                    </label>
                    {#if slot.kind === "value"}
                      <label class="small">
                        <span class="label-mono">index</span>
                        <input
                          type="number"
                          class="num-input"
                          value={String(slot.options?.index ?? "")}
                          oninput={(e) =>
                            patchOptions(i, {
                              index: num(e.currentTarget.value),
                            })}
                        />
                      </label>
                      <label class="small">
                        <span class="label-mono">decimals</span>
                        <input
                          type="number"
                          class="num-input"
                          value={String(slot.options?.decimals ?? "")}
                          oninput={(e) =>
                            patchOptions(i, {
                              decimals: num(e.currentTarget.value),
                            })}
                        />
                      </label>
                      <label class="check" title="Hide the unit to save width">
                        <input
                          type="checkbox"
                          checked={slot.options?.hideUnit !== true}
                          onchange={(e) =>
                            patchOptions(i, {
                              hideUnit: e.currentTarget.checked
                                ? undefined
                                : true,
                            })}
                        />
                        <span>unit</span>
                      </label>
                      <WhereButton
                        where={slotWhere(slot)}
                        title={whereTitle(slot)}
                        active={slotWhere(slot) !== "tile"}
                        onCycle={() => cycleWhere(i, slot)}
                      />
                    {/if}
                  </div>
                  <p class="note text-muted">
                    A hint pins no control: the display looks up the control
                    whose name, role or unit matches while it renders, so one
                    template fits every device. Picking a Source pins one
                    control and drops the hint.
                  </p>
                {/if}
                {#if slot.kind === "level"}
                  <div class="row">
                    <label class="small">
                      <span class="label-mono">min</span>
                      <input
                        type="number"
                        class="num-input"
                        value={String(slot.options?.min ?? "")}
                        oninput={(e) =>
                          patchOptions(i, { min: num(e.currentTarget.value) })}
                      />
                    </label>
                    <label class="small">
                      <span class="label-mono">max</span>
                      <input
                        type="number"
                        class="num-input"
                        value={String(slot.options?.max ?? "")}
                        oninput={(e) =>
                          patchOptions(i, { max: num(e.currentTarget.value) })}
                      />
                    </label>
                    <label class="small">
                      <span class="label-mono">step</span>
                      <input
                        type="number"
                        class="num-input"
                        value={String(slot.options?.step ?? "")}
                        oninput={(e) =>
                          patchOptions(i, {
                            step: num(e.currentTarget.value),
                          })}
                      />
                    </label>
                  </div>
                  <div class="row">
                    <label
                      class="check"
                      title="Hide the current value and unit; only the slider remains"
                    >
                      <input
                        type="checkbox"
                        checked={slot.options?.hideValue !== true}
                        onchange={(e) =>
                          patchOptions(i, {
                            hideValue: e.currentTarget.checked
                              ? undefined
                              : true,
                          })}
                      />
                      <span>show value</span>
                    </label>
                    <WhereButton
                      where={valueWhereOf(slot)}
                      title={valueWhereTitle(slot)}
                      active={valueWhereOf(slot) !== "both"}
                      onCycle={() => cycleValueWhere(i, slot)}
                    />
                  </div>
                {/if}
                {#if slot.kind === "badge"}
                  <div class="row">
                    <label class="small grow">
                      <span class="label-mono">of</span>
                      <input
                        type="text"
                        placeholder="control the clock reads"
                        value={String(slot.options?.of ?? "")}
                        oninput={(e) =>
                          patchOptions(i, {
                            of: e.currentTarget.value.trim() || undefined,
                          })}
                      />
                    </label>
                    <label class="small">
                      <span class="label-mono">from</span>
                      <select
                        value={String(slot.options?.from ?? "ts")}
                        onchange={(e) =>
                          patchOptions(i, {
                            from:
                              e.currentTarget.value === "lc" ? "lc" : undefined,
                          })}
                      >
                        <option value="ts">update (ts)</option>
                        <option value="lc">change (lc)</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      class="btn btn-sm"
                      onclick={() =>
                        edit((t) => patchSlot(t, i, { source: "ago" }))}
                      >ago</button
                    >
                    <button
                      type="button"
                      class="btn btn-sm"
                      onclick={() =>
                        edit((t) => patchSlot(t, i, { source: "offline" }))}
                      >offline</button
                    >
                  </div>
                  <div class="row">
                    <label class="small">
                      <span class="label-mono">x</span>
                      <select
                        value={String(slot.options?.x ?? "")}
                        onchange={(e) =>
                          patchOptions(i, {
                            x: e.currentTarget.value || undefined,
                          })}
                      >
                        <option
                          value=""
                          title="auto: first free of top-right, bottom-right, top-left, bottom-left"
                          >auto</option
                        >
                        <option value="left">left</option>
                        <option value="center">center</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                    <label class="small">
                      <span class="label-mono">y</span>
                      <select
                        value={String(slot.options?.y ?? "")}
                        onchange={(e) =>
                          patchOptions(i, {
                            y: e.currentTarget.value || undefined,
                          })}
                      >
                        <option
                          value=""
                          title="auto: first free of top-right, bottom-right, top-left, bottom-left"
                          >auto</option
                        >
                        <option value="top">top</option>
                        <option value="middle">middle</option>
                        <option value="bottom">bottom</option>
                      </select>
                    </label>
                    <label class="small">
                      <span class="label-mono">colour</span>
                      <select
                        value={isHexColor(String(slot.options?.color ?? ""))
                          ? "custom"
                          : String(slot.options?.color ?? "")}
                        onchange={(e) => {
                          const value = e.currentTarget.value;
                          if (value === "custom") {
                            if (
                              !isHexColor(String(slot.options?.color ?? ""))
                            ) {
                              patchOptions(i, { color: "#494bd6" });
                            }
                            return;
                          }
                          patchOptions(i, { color: value || undefined });
                        }}
                      >
                        <option value="">default</option>
                        {#each Object.entries(BADGE_COLORS) as [name] (name)}
                          <option value={name}>{name}</option>
                        {/each}
                        <option value="custom">custom…</option>
                      </select>
                    </label>
                    {#if isHexColor(String(slot.options?.color ?? ""))}
                      <input
                        type="color"
                        class="color-input"
                        aria-label="Badge colour"
                        value={String(slot.options?.color)}
                        oninput={(e) =>
                          patchOptions(i, { color: e.currentTarget.value })}
                      />
                    {/if}
                  </div>
                {/if}
                {#if ICON_KINDS.includes(slot.kind)}
                  <div class="row">
                    <label
                      class="check"
                      title="Off keeps the glyph and its rules but renders nothing"
                    >
                      <input
                        type="checkbox"
                        checked={slot.icon !== undefined &&
                          slot.icon.enabled !== false}
                        onchange={(e) =>
                          e.currentTarget.checked
                            ? setIcon(i, { enabled: true })
                            : setIcon(i, { enabled: false })}
                      />
                      <span>Icon</span>
                    </label>
                    {#if slot.icon}
                      <button
                        type="button"
                        class="btn btn-sm glyph-pick"
                        title={slot.icon.glyph
                          ? `Glyph: ${slot.icon.glyph} — click to change`
                          : "Choose a glyph"}
                        onclick={() => (iconPickerFor = i)}
                      >
                        {#if slot.icon.glyph}
                          <Icon value={slot.icon.glyph} size={18} />
                        {:else}
                          Choose glyph…
                        {/if}
                      </button>
                      <WhereButton
                        where={slot.icon.where ?? "both"}
                        title={iconWhereTitle(i)}
                        active={slot.icon.where !== undefined}
                        onCycle={() =>
                          edit((t) =>
                            patchIcon(t, i, {
                              where:
                                nextIconWhere(i) === "both"
                                  ? undefined
                                  : nextIconWhere(i),
                            }),
                          )}
                      />
                    {/if}
                  </div>
                  {#if slot.icon && !slot.icon.glyph && !(slot.rules ?? []).some((r) => r.icon)}
                    <p class="note text-muted">
                      No glyph yet — choose one, or let a rule supply it.
                    </p>
                  {:else if (slot.rules ?? []).some((r) => r.icon)}
                    <p class="note text-muted">
                      A rule's glyph wins while it matches, so the tile may show
                      that one instead of this. Picking a glyph here drops the
                      rules' glyphs (their colours and states stay) — see Rules.
                    </p>
                  {/if}
                {/if}
                {#if slot.kind === "value"}
                  <div class="row">
                    <label
                      class="check"
                      title="Off keeps the colour and its homes but draws nothing"
                    >
                      <input
                        type="checkbox"
                        checked={slot.spark !== undefined &&
                          slot.spark.enabled !== false}
                        disabled={!sparkReady(i)}
                        onchange={(e) =>
                          e.currentTarget.checked
                            ? setSpark(i, { enabled: true })
                            : setSpark(i, { enabled: false })}
                      />
                      <span>Sparkline</span>
                    </label>
                    {#if slot.spark}
                      <label class="small">
                        <span class="label-mono">colour</span>
                        <select
                          value={sparkColorValue(slot)}
                          onchange={(e) => {
                            const value = e.currentTarget.value;
                            if (value === "custom") {
                              if (!isHexColor(slot.spark?.color ?? "")) {
                                setSpark(i, { color: "#494bd6" });
                              }
                              return;
                            }
                            setSpark(i, { color: value || undefined });
                          }}
                        >
                          <option value="">auto</option>
                          {#each Object.entries(BADGE_COLORS) as [name, token] (name)}
                            <option value={token}>{name}</option>
                          {/each}
                          <option value="custom">custom…</option>
                        </select>
                      </label>
                      {#if isHexColor(slot.spark.color ?? "")}
                        <input
                          type="color"
                          class="color-input"
                          aria-label="Chart colour"
                          value={slot.spark.color}
                          oninput={(e) =>
                            setSpark(i, { color: e.currentTarget.value })}
                        />
                      {/if}
                      <button
                        type="button"
                        class="icon-btn"
                        class:on={slot.spark.where !== undefined}
                        title={sparkWhereTitle(i)}
                        aria-label={sparkWhereTitle(i)}
                        onclick={() =>
                          edit((t) =>
                            patchSpark(t, i, {
                              where:
                                nextSparkWhere(i) === "both"
                                  ? undefined
                                  : nextSparkWhere(i),
                            }),
                          )}
                      >
                        <span class="material-symbols-outlined"
                          >{WHERE_GLYPH[slot.spark.where ?? "both"]}</span
                        >
                      </button>
                    {/if}
                  </div>
                  {#if !sparkReady(i)}
                    <p class="note text-muted">
                      No history for this control — configure it in the device
                      editor.
                    </p>
                  {/if}
                {/if}
                <div class="slot-rules">
                  <button
                    type="button"
                    class="rules-toggle"
                    onclick={() => (openRules = openRules === i ? null : i)}
                  >
                    Rules ({slot.rules?.length ?? 0})
                  </button>
                  {#if openRules === i}
                    <p class="note text-muted">
                      Last match wins. <code>active</code> (the tile's active
                      state) is available in <code>when</code>. A rule's
                      <code>icon</code> swaps the slot icon's glyph (only while the
                      icon is enabled).
                    </p>
                    {#each slot.rules ?? [] as rule, ri (ri)}
                      <div class="rule-row">
                        <div class="rule-line">
                          <span
                            class="dot"
                            class:true={ruleDot(rule.when) === "true"}
                            class:error={ruleDot(rule.when) === "error"}
                            title="Live result of this expression"
                          ></span>
                          <input
                            type="text"
                            class="when"
                            placeholder="when… e.g. power == 1"
                            value={rule.when}
                            oninput={(e) =>
                              edit((t) =>
                                patchRule(t, i, ri, {
                                  when: e.currentTarget.value,
                                }),
                              )}
                          />
                          <span class="row-actions">
                            <button
                              type="button"
                              class="icon-btn"
                              title="Move up"
                              aria-label="Move rule up"
                              disabled={ri === 0}
                              onclick={() =>
                                edit((t) => moveRule(t, i, ri, ri - 1))}
                            >
                              <span class="material-symbols-outlined"
                                >arrow_upward</span
                              >
                            </button>
                            <button
                              type="button"
                              class="icon-btn"
                              title="Move down"
                              aria-label="Move rule down"
                              disabled={ri === (slot.rules?.length ?? 0) - 1}
                              onclick={() =>
                                edit((t) => moveRule(t, i, ri, ri + 1))}
                            >
                              <span class="material-symbols-outlined"
                                >arrow_downward</span
                              >
                            </button>
                            <button
                              type="button"
                              class="icon-btn"
                              title="Remove rule"
                              aria-label="Remove rule"
                              onclick={() => edit((t) => removeRule(t, i, ri))}
                            >
                              <span class="material-symbols-outlined"
                                >delete</span
                              >
                            </button>
                          </span>
                        </div>
                        <div class="rule-line">
                          <button
                            type="button"
                            class="btn btn-sm"
                            onclick={() =>
                              (ruleIconFor = { slot: i, rule: ri })}
                          >
                            {rule.icon || "icon…"}
                          </button>
                          {#if rule.icon}
                            <button
                              type="button"
                              class="btn btn-sm"
                              onclick={() =>
                                edit((t) =>
                                  patchRule(t, i, ri, { icon: undefined }),
                                )}>clear</button
                            >
                          {/if}
                          <input
                            type="color"
                            class="color-input"
                            aria-label="Rule colour"
                            value={isHexColor(rule.color)
                              ? rule.color
                              : "#000000"}
                            oninput={(e) =>
                              edit((t) =>
                                patchRule(t, i, ri, {
                                  color: e.currentTarget.value,
                                }),
                              )}
                          />
                          {#if rule.color}
                            <button
                              type="button"
                              class="btn btn-sm"
                              onclick={() =>
                                edit((t) =>
                                  patchRule(t, i, ri, { color: undefined }),
                                )}>clear</button
                            >
                          {/if}
                          <label class="check">
                            <input
                              type="checkbox"
                              checked={rule.glow === true}
                              onchange={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    glow: e.currentTarget.checked || undefined,
                                  }),
                                )}
                            />
                            <span>glow</span>
                          </label>
                          <label class="check">
                            <input
                              type="checkbox"
                              checked={rule.hidden === true}
                              onchange={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    hidden:
                                      e.currentTarget.checked || undefined,
                                  }),
                                )}
                            />
                            <span>hidden</span>
                          </label>
                          <label
                            class="check"
                            title="Show the slot only while this rule matches"
                          >
                            <input
                              type="checkbox"
                              checked={rule.only === true}
                              onchange={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    only: e.currentTarget.checked || undefined,
                                  }),
                                )}
                            />
                            <span>only</span>
                          </label>
                          <label class="check">
                            <input
                              type="checkbox"
                              checked={rule.disabled === true}
                              onchange={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    disabled:
                                      e.currentTarget.checked || undefined,
                                  }),
                                )}
                            />
                            <span>disabled</span>
                          </label>
                        </div>
                        <div class="rule-line">
                          <label class="small grow">
                            <span class="label-mono">background</span>
                            <input
                              type="text"
                              value={rule.background ?? ""}
                              oninput={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    background:
                                      e.currentTarget.value.trim() || undefined,
                                  }),
                                )}
                            />
                          </label>
                          <label class="small">
                            <span class="label-mono">tone</span>
                            <select
                              value={rule.tone ?? ""}
                              onchange={(e) =>
                                edit((t) =>
                                  patchRule(t, i, ri, {
                                    tone: e.currentTarget.value || undefined,
                                  }),
                                )}
                            >
                              <option value="">—</option>
                              <option value="info">info</option>
                              <option value="ok">ok</option>
                              <option value="warn">warn</option>
                              <option value="danger">danger</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    {/each}
                    <button
                      type="button"
                      class="btn btn-sm"
                      onclick={() =>
                        edit((t) => addRule(t, i, { when: "active" }))}
                      >Add rule</button
                    >
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <label class="field">
      <span class="label-mono">Move to section</span>
      <select
        value={`${page?.id ?? ""}|${section?.id ?? ""}`}
        onchange={(e) => moveTileTo(e.currentTarget.value)}
      >
        {#each registry.pages as p (p.id)}
          <optgroup label={p.title || p.id}>
            {#each p.groups as g (g.id)}
              <option
                value={`${p.id}|${g.id}`}
                disabled={p.id === page?.id && g.id === section?.id}
              >
                {g.title || g.id}
              </option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
  {/if}

  {#if iconPicker}
    <IconPicker
      icon={iconPicker === "page" ? page?.icon : section?.icon}
      onPick={(value) => {
        if (iconPicker === "page") setPage({ icon: value });
        else setSection({ icon: value });
        iconPicker = null;
      }}
      onClose={() => (iconPicker = null)}
    />
  {/if}

  {#if activePicker}
    <StatePicker
      deviceType="Custom"
      {devices}
      objects={ioBroker.objects}
      {roomsOf}
      {rooms}
      enums={ioBroker.enums}
      mode="slot"
      onAdd={() => {}}
      onSlotSource={setActiveSource}
      onClose={() => (activePicker = false)}
    />
  {/if}

  {#if sourcePickerFor !== null}
    <StatePicker
      deviceType="Custom"
      {devices}
      objects={ioBroker.objects}
      {roomsOf}
      {rooms}
      enums={ioBroker.enums}
      mode="slot"
      onAdd={() => {}}
      onSlotSource={(source) => {
        const slotIndex = sourcePickerFor;
        sourcePickerFor = null;
        if (slotIndex === null) return;
        edit((t) => setSlotSource(t, slotIndex, source));
      }}
      onClose={() => (sourcePickerFor = null)}
    />
  {/if}

  {#if ruleIconFor}
    <IconPicker
      icon={shownSlots[ruleIconFor.slot]?.rules?.[ruleIconFor.rule]?.icon}
      onPick={(value) => {
        const target = ruleIconFor;
        ruleIconFor = null;
        if (!target) return;
        edit((t) =>
          patchRule(t, target.slot, target.rule, {
            icon: value || undefined,
          }),
        );
      }}
      onClose={() => (ruleIconFor = null)}
    />
  {/if}

  {#if iconPickerFor !== null}
    <IconPicker
      icon={shownSlots[iconPickerFor]?.icon?.glyph}
      onPick={(value) => {
        const target = iconPickerFor;
        iconPickerFor = null;
        if (target === null) return;
        const glyph = value.trim();
        edit((t) => {
          const next = patchIcon(t, target, { glyph: glyph || undefined });
          // A chosen glyph is the face the user wants; a rule's glyph would hide
          // it, so the rules lose theirs (colours and `disabled` stay).
          return glyph ? clearRuleIcons(next, target) : next;
        });
      }}
      onClose={() => (iconPickerFor = null)}
    />
  {/if}

  {#if lookIconFor !== null}
    <IconPicker
      icon={tile?.tile?.look?.[lookIconFor]?.glyph}
      onPick={(value) => {
        const target = lookIconFor;
        lookIconFor = null;
        if (target === null) return;
        patchLook(target, { glyph: value.trim() || undefined });
      }}
      onClose={() => (lookIconFor = null)}
    />
  {/if}
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  .details h3 {
    margin: 0;
    font-size: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .field .glyph {
    display: inline-flex;
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .row input[type="text"] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row.between {
    justify-content: space-between;
  }

  /* The detail page's line: the PIN group sits at the far end, and the field
     is only as wide as its six digits. */
  .pin-label {
    margin-left: auto;
  }

  .row input.pin-input {
    flex: 0 0 auto;
    width: 8ch;
    text-align: center;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--body-sm);
  }

  .small {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .live {
    font-size: 0.75rem;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .slot-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
    padding: 3px 5px;
  }

  /* De-emphasis by colour, never opacity (house rule). */
  .slot-row.not-now .slot-summary {
    color: var(--text-muted);
  }

  .slot-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .slot-head {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }

  .slot-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Its own gap: the svelte compiler trims the space before an inline element. */
  .hint-mark {
    margin-left: 0.25rem;
  }

  .hint-badge {
    flex: 0 0 auto;
    font-size: 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    padding: 0 6px;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
  }

  .row-actions.end {
    margin-left: auto;
  }

  .row-actions .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0 2px;
  }

  .row-actions .icon-btn:hover:not(:disabled) {
    color: var(--text-color);
  }

  .row-actions .icon-btn:disabled {
    color: var(--border-color);
    cursor: default;
  }

  /* A destination or visibility away from its default (A34) reads at a glance. */
  .row-actions .icon-btn.on {
    color: var(--primary-color);
  }

  .slot-editor {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 2px 0 2px 0.5rem;
    border-left: 2px solid var(--border-color);
  }

  .slot-editor .small input,
  .slot-editor .small select {
    min-width: 0;
  }

  .source-pick {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: flex-start;
  }

  .source-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .grow input {
    width: 100%;
  }

  .num-input {
    width: 4.5rem;
  }

  .unit-input {
    width: 3.5rem;
  }

  .color-input {
    inline-size: 2rem;
    block-size: 1.5rem;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: transparent;
  }

  .slot-rules {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .rules-toggle {
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0;
    cursor: pointer;
  }

  .rules-toggle:hover {
    color: var(--text-color);
  }

  .rule-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px dashed var(--border-color);
    padding-top: 3px;
  }

  .rule-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .rule-line .when {
    flex: 1 1 auto;
    min-width: 0;
  }

  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-color);
  }

  .dot.true {
    background: var(--success-color, #2e7d32);
  }

  .dot.error {
    background: var(--danger-color, #c0392b);
  }

  /* The active look (A71): glyph, colours and background per state. */
  .look {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.1rem 0 0 0.5rem;
    border-left: 2px solid var(--border-color);
  }

  .look-block {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .look-block + .look-block {
    padding-top: 0.45rem;
    border-top: 1px solid var(--border-color);
  }

  .look-bg {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .look-bg-body {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .look-state {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }

  .look-name {
    min-width: 4.2rem;
  }

  .glyph-default {
    display: inline-flex;
    opacity: 0.5;
  }

  .note {
    font-size: 0.75rem;
    margin: 0;
  }

  .warn {
    color: var(--warning-color);
    font-size: var(--body-sm);
  }

  /* The section preview is a real tile grid at the current breakpoint's module
     size, so a tile shows at the width and height the display will give it. */
  .preview {
    margin-top: 0.25rem;
    padding: 0.5rem;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    /* A tile wider than the pane (a big hint, previewed on a narrow column)
       keeps its real width and scrolls here instead of bleeding out (A2). */
    overflow-x: auto;
  }
</style>
