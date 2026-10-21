<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { isHexColor } from "$lib/config/appearance";
  import {
    movePlacement,
    patchPage,
    patchPlacement,
    patchSection,
    type LayoutSelection,
    type PlacementAnchor,
  } from "$lib/config/layout-ops";
  import {
    resolveSection,
    toFilterable,
    type FilterableDevice,
  } from "$lib/config/pages-ops";
  import {
    BREAKPOINTS,
    SIZE_MAX,
    breakpointFor,
    type TileSpan,
  } from "$lib/config/size-ops";
  import {
    effectiveSpan,
    pickable,
    pickControl,
    pickSlotControls,
    resolveControl,
    resolveTemplate,
    slotVisible,
  } from "$lib/config/template-ops";
  import {
    addRule,
    applyTemplate,
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
    templateFromTile,
    upsertTemplate,
  } from "$lib/config/tile-ops";
  import { hasHistory, headlineSlot } from "$lib/config/tile-parts";
  import { BADGE_COLORS, ruleScope } from "$lib/config/rule-ops";
  import { evaluateVirtual } from "$lib/config/virtual-ops";
  import { getVirtualPool } from "$lib/stores/devices";
  import {
    commitTemplates,
    getTemplateRegistry,
    getTemplateSaveFailed,
    isTemplatesWritable,
  } from "$lib/stores/templates.svelte.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import GroupSection from "$lib/components/display/GroupSection.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import BackgroundEditor from "$lib/components/common/BackgroundEditor.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import SlotPicker from "$lib/components/layout/SlotPicker.svelte";
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
    SlotSpark,
    StateLook,
    TileConfig,
  } from "$lib/types/display";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";
  import type { Snippet } from "svelte";

  let {
    registry,
    devices,
    selection,
    onChange,
    onSelect,
    onAddSlot,
    titleExtra,
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
    /** The layout sheet puts its own control on the Tile title's line. */
    titleExtra?: Snippet;
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
  /** Template actions in flight. */
  let templateName = $state("");
  let pendingReplace = $state<string | null>(null);
  let applyId = $state("");
  let pendingApply = $state(false);
  let pendingReset = $state(false);
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
  const device = $derived(
    tile ? devices.find((d) => d.id === tile.device) : undefined,
  );

  const templates = $derived(getTemplateRegistry().templates ?? []);
  const typeTemplates = $derived(
    device ? templates.filter((t) => t.type === device.type) : [],
  );

  /** Where the tile's config came from: a user template, or the device chain. */
  const sourceLine = $derived.by(() => {
    const id = tile?.tile?.template;
    if (!id) return "device chain";
    const name = templates.find((t) => t.id === id)?.name;
    return name ? `copied from ${name}` : "device chain";
  });

  const activeCond = $derived(tile?.tile?.active);
  const activeControl = $derived(
    activeCond?.source && device
      ? resolveControl(device.controls ?? [], activeCond.source)
      : undefined,
  );
  const activeFound = $derived(
    !activeCond?.source ||
      !!activeControl ||
      !!(ioBroker.objects as Map<string, any>)?.get?.(activeCond.source),
  );
  const activeValue = $derived(
    activeControl
      ? activeControl.liveValue
      : (ioBroker.states as Map<string, any>)?.get?.(activeCond?.source ?? "")
          ?.val,
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

  /** The rows the pane lists: the tile's own slots, else the chain's (A18). */
  const shownSlots = $derived(
    tile?.tile?.slots ??
      (device ? resolveTemplate(device, templates).slots : []),
  );

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

  /** The pane's own resolution of the slots, for the Sparkline hint (A63). */
  const pickedRows = $derived(
    device
      ? pickSlotControls(shownSlots, device.controls ?? [], {
          active: tileActive,
        })
      : [],
  );

  const KIND_GLYPH: Record<SlotKind, string> = {
    value: "numbers",
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

  // The preview resolves through the display's own resolver, so it needs the
  // same device shape the display feeds it.
  type DisplayDevice = EnrichedDevice & FilterableDevice;
  const displayDevices = $derived(
    devices.map((d) => toFilterable(d)) as DisplayDevice[],
  );

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
    if (!page || !section || !tile || !device) return;
    onChange(
      editTile(
        registry,
        { pageId: page.id, sectionId: section.id, placementId: tile.id },
        device,
        getTemplateRegistry().templates,
        fn,
      ),
    );
  }

  /** This tile's address, or null when the selection drifted (deleted tile). */
  function anchor(): PlacementAnchor | null {
    if (!page || !section || !tile) return null;
    return { pageId: page.id, sectionId: section.id, placementId: tile.id };
  }

  /**
   * The size the tile actually renders at: its placement's own size when set,
   * else its template's — the same calculation the display and the section pass
   * use. The fields must never show (or write back) a size other than this, or
   * editing one axis silently changes the other.
   */
  function effectiveTileSpan(): TileSpan {
    if (!tile) return { w: 1, h: 1 };
    return effectiveSpan(
      tile.tile,
      devices.find((d) => d.id === tile!.device),
      getTemplateRegistry().templates,
      bp,
    );
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

  function setActiveSource(source: string): void {
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

  function saveTemplate(): void {
    const name = templateName.trim();
    if (!name || !tile || !device) return;
    if (templates.some((t) => t.name === name && t.type === device.type)) {
      pendingReplace = name;
      return;
    }
    doSaveTemplate(name);
  }

  function doSaveTemplate(name: string): void {
    if (!tile || !device) return;
    const next = templateFromTile(tile.tile ?? {}, device, templates, name);
    commitTemplates(upsertTemplate(getTemplateRegistry(), next));
    pendingReplace = null;
    templateName = "";
  }

  function doApply(): void {
    const chosen = templates.find((t) => t.id === applyId);
    if (!chosen || !tile) return;
    setTile({ tile: applyTemplate(tile, chosen).tile });
    pendingApply = false;
    applyId = "";
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
   * The control a slot's hint finds right now — on a fresh hand, because the
   * display walks the slots in order and grows a used-set as it goes (A36).
   */
  function hintedControl(slot: Slot): EnrichedControl | undefined {
    const hint = String(slot.options?.pick ?? "");
    if (!hint.trim()) return undefined;
    const picked = pickControl(
      pickable(device?.controls ?? []),
      hint,
      new SvelteSet<string>(),
    );
    return picked
      ? (device?.controls ?? []).find((c) => c.id === picked.id)
      : undefined;
  }

  /**
   * What a slot row shows next to its kind: the control it reads under the
   * device's own name for it (A36) — a raw state keeps its id, a hint names
   * the control it finds. The hint's own wording stays in the fold-out editor.
   */
  function slotLabel(slot: Slot): string {
    if (slot.kind === "frame") {
      const url = String(slot.options?.url ?? "");
      return url || "no page";
    }
    if (slot.source) {
      const control = resolveControl(device?.controls ?? [], slot.source);
      return control ? control.label || control.feature : slot.source;
    }
    const hinted = hintedControl(slot);
    if (hinted) return hinted.label || hinted.feature;
    const hint = String(slot.options?.pick ?? "");
    return hint.trim() ? hint : "auto";
  }

  /** A source that names a raw state object rather than a control (A21). */
  function isRawState(source: string): boolean {
    return !!(ioBroker.objects as Map<string, any>)?.get?.(source);
  }

  /**
   * A20: a source or hint that matches nothing is dormant on the display, so the
   * pane marks it and offers to bind it. `ago`/`offline` are the badge clock's
   * own sources, not control names.
   */
  function slotUnresolved(slot: Slot): boolean {
    if (
      slot.kind === "badge" &&
      (slot.source === "ago" || slot.source === "offline")
    )
      return false;
    if (slot.source) {
      return (
        !resolveControl(device?.controls ?? [], slot.source) &&
        !isRawState(slot.source)
      );
    }
    const hint = String(slot.options?.pick ?? "");
    if (!hint.trim()) return false;
    return !hintedControl(slot);
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
    const slot = shownSlots[i];
    return hasHistory(pickedRows.find((r) => r.slot === slot)?.control);
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
      style={`--tile-w: ${def.tileW}px; --tile-h: ${def.tileH}px;`}
    >
      <GroupSection
        group={section}
        tiles={resolveSection(section, displayDevices)}
        {bp}
        pageId={page?.id ?? ""}
      />
    </div>
  {:else if selection.kind === "tile" && tile}
    <div class="row between">
      <h3>{tile.title || device?.name || "Tile"}</h3>
      {#if titleExtra}{@render titleExtra()}{/if}
    </div>
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
    <label class="check">
      <input
        type="checkbox"
        checked={tile.newLine === true}
        onchange={(e) => setTile({ newLine: e.currentTarget.checked })}
      />
      <span>Start a new line before this tile</span>
    </label>

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
          {activeCond?.source || "not set"}
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
          <button
            type="button"
            class="icon-btn"
            title="Clear the active condition"
            aria-label="Clear the active condition"
            onclick={clearActive}
          >
            <span class="material-symbols-outlined">delete</span>
          </button>
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

    <div class="field">
      <div class="row between">
        <span class="label-mono">Slots</span>
        <span class="row-actions">
          <button
            type="button"
            class="icon-btn"
            title="Add slot"
            aria-label="Add slot"
            disabled={!device}
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
                <button
                  type="button"
                  class="icon-btn"
                  class:on={slotWhere(slot) !== "tile"}
                  title={whereTitle(slot)}
                  aria-label={whereTitle(slot)}
                  onclick={() => cycleWhere(i, slot)}
                >
                  <span class="material-symbols-outlined"
                    >{WHERE_GLYPH[slotWhere(slot)]}</span
                  >
                </button>
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
                  title="Remove slot"
                  aria-label="Remove slot"
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
                          ? `Change source — now ${slot.source}`
                          : "Pin one control instead of a hint"}
                        onclick={() => (sourcePickerFor = i)}
                      >
                        <Icon value="edit" size={15} />
                        <span class="source-name"
                          >{slot.source
                            ? slotLabel(slot)
                            : slot.options?.pick
                              ? `${slotLabel(slot)} (hint)`
                              : "auto (next control)"}</span
                        >
                      </button>
                      {#if slot.source && isRawState(slot.source)}
                        <span class="hint-badge text-muted">read-only</span>
                      {/if}
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
                      <button
                        type="button"
                        class="icon-btn"
                        class:on={slot.icon.where !== undefined}
                        title={iconWhereTitle(i)}
                        aria-label={iconWhereTitle(i)}
                        onclick={() =>
                          edit((t) =>
                            patchIcon(t, i, {
                              where:
                                nextIconWhere(i) === "both"
                                  ? undefined
                                  : nextIconWhere(i),
                            }),
                          )}
                      >
                        <span class="material-symbols-outlined"
                          >{WHERE_GLYPH[slot.icon.where ?? "both"]}</span
                        >
                      </button>
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

    <div class="field">
      <span class="label-mono">Template</span>
      <span class="device-name">{sourceLine}</span>
      <div class="row">
        <input
          type="text"
          placeholder="template name"
          bind:value={templateName}
        />
        <button
          type="button"
          class="btn btn-sm"
          disabled={!isTemplatesWritable() || !templateName.trim()}
          onclick={saveTemplate}>Save as template…</button
        >
        {#if getTemplateSaveFailed()}
          <span
            class="badge badge-danger"
            title="The last write to templateList failed">not saved</span
          >
        {/if}
      </div>
      {#if typeTemplates.length}
        <div class="row">
          <select bind:value={applyId}>
            <option value="">apply a template…</option>
            {#each typeTemplates as t (t.id)}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
          <button
            type="button"
            class="btn btn-sm"
            disabled={!applyId}
            onclick={() => (pendingApply = true)}>Apply</button
          >
        </div>
      {/if}
      {#if tile.tile}
        <div class="row">
          <button
            type="button"
            class="btn btn-sm"
            onclick={() => (pendingReset = true)}>Reset to chain</button
          >
        </div>
      {/if}
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

  {#if activePicker && device}
    <SlotPicker
      {device}
      mode="source"
      onAdd={() => {}}
      onSource={setActiveSource}
      onClose={() => (activePicker = false)}
    />
  {/if}

  {#if sourcePickerFor !== null && device}
    <SlotPicker
      {device}
      mode="source"
      onAdd={() => {}}
      onSource={(source) => {
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

  {#if pendingReplace}
    <ConfirmModal
      title={`Replace “${pendingReplace}”?`}
      confirmLabel="Replace"
      onConfirm={() => doSaveTemplate(pendingReplace!)}
      onCancel={() => (pendingReplace = null)}
    >
      A template of that name already exists for this device type. Saving
      replaces it (same id), so every tile that uses it changes too.
    </ConfirmModal>
  {/if}

  {#if pendingApply}
    <ConfirmModal
      title="Apply this template?"
      confirmLabel="Apply"
      onConfirm={doApply}
      onCancel={() => (pendingApply = false)}
    >
      Its size, slots and background replace the tile's. The active condition
      and the tile's title stay.
    </ConfirmModal>
  {/if}

  {#if pendingReset}
    <ConfirmModal
      title="Reset this tile?"
      confirmLabel="Reset"
      onConfirm={() => {
        setTile({ tile: undefined });
        pendingReset = false;
      }}
      onCancel={() => (pendingReset = false)}
    >
      The tile returns to its device/template chain.
    </ConfirmModal>
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

  .device-name {
    font-size: var(--body-sm);
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
