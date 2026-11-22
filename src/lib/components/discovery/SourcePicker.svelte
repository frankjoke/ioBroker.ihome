<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList, roomsOf as roomsOfEnum } from "$lib/config/rooms";
  import StateBrowser from "$lib/components/discovery/StateBrowser.svelte";
  import { helpLine } from "$lib/config/template-entries";
  import { slotFromState, slotKindForWidget } from "$lib/config/slot-create";
  import UrlTemplatePreview from "$lib/components/display/UrlTemplatePreview.svelte";
  import { sourceChipKey, widgetForState } from "$lib/config/slot-source";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { getOverrideRegistry } from "$lib/stores/overrides.svelte";
  import { stateIdFor } from "$lib/config/variables";
  import { localizeName } from "$lib/config/format";
  import type { LogicDef } from "$logic/types";
  import type {
    Slot,
    SlotKind,
    SlotSource,
    Template,
  } from "$lib/types/display";

  /** What the caller does with the picked data — the only difference between
   *  the slot picker (a tile), a source (an active condition or slot) and
   *  Variables/Logic (a state). */
  export type PickerMode = "slot" | "source" | "state";

  let {
    mode,
    title,
    templates = [],
    slots = [],
    /** The state this item already uses: the tree opens at it. */
    currentState = "",
    /** A new tile starts from values, not badges (the slot part adds those). */
    showBadge = true,
    suggestTemplates = false,
    onStatePicked,
    onSlots,
    onSource,
    onState,
    onTemplate,
    onClose,
    logics = [],
    logicPick = undefined,
    warning = "",
    hint = "",
  }: {
    mode: PickerMode;
    title: string;
    templates?: Template[];
    /** A tile's slots: its own sources are offered as shortcuts. */
    slots?: Slot[];
    /** The state this item already uses: the tree opens at it. */
    currentState?: string;
    /** Show the Badge tab. A new tile starts from values; an added slot may be
     *  a badge. */
    showBadge?: boolean;
    /** New tile: hand a picked state (and its override) back instead of
     *  creating a slot. */
    suggestTemplates?: boolean;
    onStatePicked?: (id: string, object: any, overrideId?: string) => void;
    onSlots?: (slots: Slot[]) => void;
    onSource?: (source: SlotSource) => void;
    onState?: (stateId: string, overrideId?: string) => void;
    /** New-tile Templates tab: the chosen tile template. */
    onTemplate?: (template: Template) => void;
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
    /** What a logic selection means: an event trigger or its output state. */
    logicPick?: "trigger" | "state";
    /** A note about unavailable plugin entries, shown above the tabs. */
    warning?: string;
    /** What to pick, from the template that opened this picker. */
    hint?: string;
    onClose: () => void;
  } = $props();

  type Tab = "state" | "template" | "page" | "badge" | "html";

  const TABS: Record<PickerMode, { id: Tab; label: string }[]> = {
    slot: [
      { id: "state", label: "Any state" },
      { id: "template", label: "Templates" },
      { id: "page", label: "Web page" },
      { id: "badge", label: "Badge" },
      { id: "html", label: "HTML" },
    ],
    source: [{ id: "state", label: "Any state" }],
    state: [{ id: "state", label: "Any state" }],
  };
  const tabs = $derived(
    TABS[mode]
      .filter((entry) => showBadge || entry.id !== "badge")
      .filter((entry) => entry.id !== "template" || suggestTemplates),
  );

  /** Template list for the new-tile tab: name, type and description. */
  const filteredTemplates = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return templates.filter(
      (template) =>
        !query ||
        `${template.name ?? ""} ${template.type} ${template.description ?? ""} ${helpLine(template.help ?? "")}`
          .toLowerCase()
          .includes(query),
    );
  });

  // A picker opens on the state tree: it is the one tab every mode has.
  let tab = $state<Tab>("state");
  let search = $state("");
  let stateKind = $state<"auto" | SlotKind>("auto");
  let url = $state("");
  let html = $state("");
  let badgeKind = $state<"value" | "ago" | "offline">("value");
  let root = $state<HTMLElement>();

  const objects = $derived(ioBroker.objects as Map<string, any>);
  const rooms = $derived(roomList(ioBroker.enums));
  const roomsOf = (id: string) => roomsOfEnum(ioBroker.enums, id);

  /** A tree leaf may be a variable name; its metadata is the real state's
   *  object, while the slot keeps the name (the alias resolves it live). */
  function objectForState(id: string): any {
    const variable = getVariables().find(
      (v) => v.kind === "state" && v.name === id,
    );
    const realId = variable?.stateId ? String(variable.stateId) : id;
    return (
      objects.get(realId) ??
      (variable
        ? {
            common: {
              name: variable.name,
              type: variable.type,
              role: variable.role,
              unit: variable.unit,
              write: false,
            },
          }
        : undefined)
    );
  }

  function stateSource(id: string, overrideId?: string): SlotSource {
    return {
      kind: "state",
      stateId: id,
      ...(overrideId ? { override: overrideId } : {}),
    };
  }

  /** What an override presents: a repair wins over the broker object, while a
   *  derived value supplies its own fields and inherits nothing (the resolver's
   *  same rule), so the slot kind follows the override, not the raw object. */
  function objectForOverride(object: any, overrideId?: string): any {
    if (!overrideId) return object;
    const override = getOverrideRegistry().overrides.find(
      (o) => o.id === overrideId,
    );
    if (!override) return object;
    const own: Record<string, unknown> = {};
    for (const key of [
      "unit",
      "type",
      "role",
      "states",
      "min",
      "max",
      "step",
    ] as const) {
      if (override[key] !== undefined) own[key] = override[key];
    }
    const name = override.label ?? override.name;
    if (name) own.name = name;
    return override.kind === "repair"
      ? { ...object, common: { ...(object?.common ?? {}), ...own } }
      : { common: own };
  }

  /** The states this tile already binds — the picker's shortcut chips. */
  const usedSources = $derived.by(() => {
    if ((mode !== "slot" && mode !== "source") || slots.length === 0) {
      return [];
    }
    const used: {
      key: string;
      label: string;
      title?: string;
      source: SlotSource;
    }[] = [];
    const seen = new SvelteSet<string>();
    for (const slot of slots) {
      const source = slot.source;
      if (!source || typeof source === "string" || source.kind !== "state") {
        continue;
      }
      const id = stateIdFor(source.stateId, getVariables());
      const key = sourceChipKey(source, id);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = localizeName(objects.get(id)?.common?.name);
      const override = source.override
        ? getOverrideRegistry().overrides.find((o) => o.id === source.override)
        : undefined;
      used.push({
        key,
        label: override?.name ?? (name || id),
        title: override ? `${id} · ${override.name}` : id,
        source,
      });
    }
    return used;
  });

  function pickState(id: string, overrideId?: string): void {
    const object = objectForOverride(objectForState(id), overrideId);
    const kind =
      stateKind === "auto"
        ? slotKindForWidget(widgetForState(object))
        : stateKind;
    onSlots?.([slotFromState(id, object, kind, overrideId)]);
  }

  /** One click on a tree leaf: add a slot, set a source, or hand a state to
   *  the Variables/Logic page. */
  function pickRawState(id: string, overrideId?: string): void {
    if (mode === "slot") {
      if (suggestTemplates) {
        onStatePicked?.(
          id,
          objectForOverride(objectForState(id), overrideId),
          overrideId,
        );
        return;
      }
      pickState(id, overrideId);
    } else if (mode === "source") onSource?.(stateSource(id, overrideId));
    else onState?.(id, overrideId);
  }

  /** A scoped chip: the source itself (source mode) or a slot from it. */
  function useSource(source: SlotSource): void {
    if (mode === "source") {
      onSource?.(source);
      return;
    }
    if (mode !== "slot" || source.kind !== "state") return;
    const object = objectForOverride(
      objectForState(source.stateId),
      source.override,
    );
    onSlots?.([
      slotFromState(
        source.stateId,
        object,
        slotKindForWidget(widgetForState(object)),
        source.override,
      ),
    ]);
  }

  /** A frame slot (A38): the page it shows is its whole content. */
  function addPage(): void {
    const text = url.trim();
    if (text) onSlots?.([{ kind: "frame", options: { url: text } }]);
  }

  /** A local HTML document: detail-only by default, full scripts and styles. */
  function addHtml(): void {
    if (!html.trim()) return;
    onSlots?.([{ kind: "html", where: "modal", options: { html: html } }]);
  }

  /** A badge is a value in a corner: it reads the picked state. `ago` uses the
   *  state's timestamp, `offline` its false/empty value. */
  function addBadge(id: string, overrideId?: string): void {
    const object = objectForOverride(objectForState(id), overrideId);
    const base = slotFromState(id, object, "badge", overrideId);
    const derive =
      badgeKind === "ago"
        ? { derive: "ago", from: "ts" }
        : badgeKind === "offline"
          ? { derive: "offline" }
          : undefined;
    onSlots?.([
      {
        ...base,
        ...(derive ? { options: { ...(base.options ?? {}), ...derive } } : {}),
      },
    ]);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Only the topmost dialog reacts: one Escape closes one layer.
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length && dialogs[dialogs.length - 1] !== root) return;
    onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  bind:this={root}
>
  <div class="modal-content">
    <div class="modal-head">
      <h3>{title}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    {#if warning}
      <p class="text-danger hint">{warning}</p>
    {/if}
    {#if hint}
      <p class="picker-hint">{hint}</p>
    {/if}

    {#if tabs.length > 1}
      <div class="option-tabs" role="tablist" aria-label="Pick from">
        {#each tabs as t (t.id)}
          <button
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            class="option-tab"
            class:active={tab === t.id}
            onclick={() => (tab = t.id)}>{t.label}</button
          >
        {/each}
        {#if mode === "slot" && tab === "state"}
          <label class="kind">
            <span class="label-mono">Kind</span>
            <select
              value={stateKind}
              onchange={(e) =>
                (stateKind = e.currentTarget.value as "auto" | SlotKind)}
            >
              <option value="auto">auto</option>
              <option value="value">value</option>
              <option value="level">level</option>
              <option value="switch">switch</option>
              <option value="color">color</option>
              <option value="enum">enum</option>
              <option value="button">button</option>
            </select>
          </label>
        {/if}
      </div>
    {/if}

    {#if tab === "state"}
      {#if usedSources.length}
        <div class="used-sources">
          <span class="used-sources-label">Used in this tile</span>
          <div class="used-sources-list">
            {#each usedSources as u (u.key)}
              <button
                type="button"
                class="used-source"
                title={u.title}
                onclick={() => useSource(u.source)}
              >
                {u.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      <StateBrowser
        {objects}
        {roomsOf}
        {rooms}
        enums={ioBroker.enums}
        onPick={pickRawState}
        {currentState}
        {logics}
        {logicPick}
        manageOverrides={mode === "slot" || mode === "source"}
      />
    {:else if tab === "template"}
      <div class="pick">
        <div class="row-input">
          <input
            type="search"
            placeholder="Search templates…"
            bind:value={search}
          />
        </div>
        {#if filteredTemplates.length === 0}
          <p class="empty text-muted">
            {search.trim()
              ? "No template matches the search."
              : "No tile templates yet — save one from a tile with the floppy in the tile editor."}
          </p>
        {:else}
          <ul class="list">
            {#each filteredTemplates as template (template.id)}
              {@const hint =
                template.description || helpLine(template.help ?? "")}
              <li>
                <button
                  type="button"
                  class="template-row"
                  onclick={() => onTemplate?.(template)}
                >
                  <span class="template-main">
                    <span class="name">{template.name || template.id}</span>
                    <span class="meta text-muted">{template.type}</span>
                  </span>
                  {#if hint}
                    <span class="template-desc text-muted">{hint}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else if tab === "page"}
      <div class="placeholder">
        <div class="row-input">
          <input
            type="text"
            placeholder="http://…/echarts/index.html?preset=…"
            bind:value={url}
          />
          <button
            type="button"
            class="btn btn-primary"
            disabled={!url.trim()}
            onclick={addPage}>Add page</button
          >
        </div>
        <UrlTemplatePreview text={url} />
        <p class="text-muted hint-note">
          The page loads in a frame (A38) — the tile's own space, or the modal's
          wide row, as this slot's destination says.
        </p>
      </div>
    {:else if tab === "html"}
      <div class="placeholder">
        <label class="small grow">
          <span class="label-mono">HTML</span>
          <textarea
            class="html-input"
            rows="10"
            bind:value={html}
            placeholder="<!doctype html>…"
          ></textarea>
        </label>
        <div class="actions">
          <span class="text-muted">
            Runs as a local document in a frame; detail page only by default.
            &#123;&#123;NAME&#125;&#125; placeholders and ihome.setState(…) work
            in it.
          </span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!html.trim()}
            onclick={addHtml}>Add HTML slot</button
          >
        </div>
      </div>
    {:else if tab === "badge"}
      <div class="placeholder">
        <label class="small">
          <span class="label-mono">Shows</span>
          <select bind:value={badgeKind}>
            <option value="value">value</option>
            <option value="ago">time since</option>
            <option value="offline">offline (state false)</option>
          </select>
        </label>
        <p class="text-muted hint-note">
          {badgeKind === "offline"
            ? "Pick the online flag; the badge shows while it is false."
            : badgeKind === "ago"
              ? "Pick the state; the badge shows the time since it last reported."
              : "Pick the state; the badge shows its value in a corner."}
        </p>
        <StateBrowser
          {objects}
          {roomsOf}
          {rooms}
          enums={ioBroker.enums}
          onPick={(id, overrideId) => addBadge(id, overrideId)}
          {currentState}
          manageOverrides={false}
        />
      </div>
    {/if}

    <div class="actions">
      {#if mode === "slot"}
        <span class="text-muted">Adds to this tile</span>
      {:else if mode === "source"}
        <span class="text-muted">Pick a state</span>
      {:else}
        <span class="text-muted">Pick a state</span>
      {/if}
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    /* Above the collection wizard (1100) and every other host modal. */
    z-index: 1200;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(720px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .picker-hint {
    margin: 0;
    padding: 0.45rem 0.6rem;
    border-left: 3px solid var(--primary-color);
    border-radius: var(--border-radius);
    background: var(--surface-container-low);
    font-size: var(--body-sm);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .option-tabs {
    --option-tab-bg: var(--surface-color);
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .kind select {
    padding: 0.25rem;
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .template-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .template-row:hover {
    background-color: var(--surface-container);
  }

  .template-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .template-main .name {
    flex: 1 1 auto;
  }

  .template-desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 0.75rem;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
  }

  .row-input {
    display: flex;
    gap: 0.5rem;
  }

  .row-input input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem;
  }

  .hint-note {
    font-size: 0.75rem;
    margin: 0;
  }

  .html-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-family);
    font-size: 0.8rem;
    line-height: 1.4;
    resize: vertical;
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .used-sources {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .used-sources-label {
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .used-sources-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-height: 7.5rem;
    overflow: auto;
  }

  .used-source {
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: 999px;
    padding: 0.25rem 0.65rem;
    cursor: pointer;
  }

  .used-source:hover {
    border-color: var(--primary-color);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .actions-buttons {
    display: flex;
    gap: 0.5rem;
  }
</style>
