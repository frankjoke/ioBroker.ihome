<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { localizeName } from "$lib/config/format";
  import {
    applyFilters,
    collectStates,
    type StateRef,
  } from "$lib/config/state-tree";
  import { sourceForControl } from "$lib/config/template-ops";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";
  import type { Slot, SlotKind } from "$lib/types/display";

  let {
    device,
    mode = "slot",
    onAdd,
    onSource,
    onClose,
  }: {
    device: EnrichedDevice;
    /** "slot" adds a whole slot; "source" only returns a source string (A30). */
    mode?: "slot" | "source";
    onAdd: (slot: Slot) => void;
    onSource?: (source: string) => void;
    onClose: () => void;
  } = $props();

  type Tab = "device" | "placeholder" | "page" | "state";

  /** Widget-like kinds only make sense on a real control of this device (A21). */
  const DEVICE_KINDS: SlotKind[] = [
    "level",
    "color",
    "enum",
    "button",
    "sparkline",
    "history-list",
  ];

  const isSource = $derived(mode === "source");

  let tab = $state<Tab>("device");
  let kind = $state<SlotKind>("value");
  let search = $state("");
  let hint = $state("");
  let url = $state("");

  /** Source mode only chooses a string, so there is no placeholder or page tab. */
  const TABS: { id: Tab; label: string }[] = [
    { id: "device", label: "This device" },
    { id: "placeholder", label: "Placeholder" },
    { id: "page", label: "Web page" },
    { id: "state", label: "Any state" },
  ];
  const tabs = $derived(
    isSource
      ? TABS.filter((t) => t.id !== "placeholder" && t.id !== "page")
      : TABS,
  );

  function kindsFor(t: Tab): SlotKind[] {
    if (t === "page") return ["frame"];
    // No "icon" any more (A56/A57): the icon is a property of the slot it decorates.
    return t === "device"
      ? ["value", "badge", ...DEVICE_KINDS]
      : ["value", "badge"];
  }

  const kinds = $derived(kindsFor(tab));

  function setTab(next: Tab) {
    tab = next;
    if (!kindsFor(next).includes(kind)) kind = "value";
  }

  const controls = $derived((device.controls ?? []).filter((c) => !c.hidden));

  /** What a picked control writes into the slot (A36): the control's feature
   *  while that is unambiguous on this device, else the id naming exactly it. */
  function sourceOf(c: EnrichedControl): string {
    return sourceForControl(controls, c) || c.id;
  }

  const allStates = $derived(
    collectStates(ioBroker.objects as Map<string, any>),
  );
  const matches = $derived(applyFilters(allStates, { search }).slice(0, 200));

  function stateValue(id: string): string {
    const val = (ioBroker.states as Map<string, any>)?.get?.(id)?.val;
    if (val == null) return "";
    return typeof val === "object" ? JSON.stringify(val) : String(val);
  }

  function stateName(s: StateRef): string {
    return localizeName(s.obj?.common?.name) || s.id;
  }

  function pickControl(c: EnrichedControl) {
    if (isSource) onSource?.(sourceOf(c));
    else onAdd({ kind, source: sourceOf(c) });
  }

  function pickState(s: StateRef) {
    if (isSource) onSource?.(s.id);
    else onAdd({ kind, source: s.id });
  }

  function addPlaceholder() {
    const text = hint.trim();
    if (!text) return;
    onAdd({ kind, options: { pick: text } });
  }

  /** A frame slot (A38): the page it shows is its whole content. */
  function addPage() {
    const text = url.trim();
    if (!text) return;
    onAdd({ kind: "frame", options: { url: text } });
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label={isSource ? "Choose a source" : "Add a slot"}
>
  <div class="modal-content">
    <div class="modal-head">
      <h3>{isSource ? "Choose a source" : "Add a slot"}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="tabs" role="tablist">
      {#each tabs as t (t.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          class="tab"
          class:active={tab === t.id}
          onclick={() => setTab(t.id)}>{t.label}</button
        >
      {/each}
      {#if !isSource && tab !== "page"}
        <label class="kind">
          <span class="label-mono">Kind</span>
          <select
            value={kind}
            onchange={(e) => (kind = e.currentTarget.value as SlotKind)}
          >
            {#each kinds as k (k)}
              <option value={k}>{k}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    {#if tab === "state"}
      <input
        type="search"
        placeholder="Search any state…"
        bind:value={search}
      />
    {/if}

    <div class="results">
      {#if tab === "device"}
        {#if controls.length === 0}
          <p class="empty text-muted">This device has no controls to offer.</p>
        {:else}
          <ul class="list">
            {#each controls as c (c.id)}
              <li>
                <button
                  type="button"
                  class="row"
                  onclick={() => pickControl(c)}
                >
                  <span class="name">{c.label || c.feature}</span>
                  <span class="meta text-muted">{c.stateId || c.id}</span>
                  {#if c.unit}
                    <span class="meta text-muted">{c.unit}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if tab === "placeholder"}
        <div class="placeholder">
          <div class="row-input">
            <input
              type="text"
              placeholder="e.g. temperature, Leistung…"
              bind:value={hint}
            />
            <button
              type="button"
              class="btn btn-primary"
              disabled={!hint.trim()}
              onclick={addPlaceholder}>Add hint</button
            >
          </div>
          <p class="text-muted hint-note">
            The hint resolves the control whose name matches it while the
            display renders; a device without one shows nothing here and keeps
            the other rows where they are (A20).
          </p>
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
          <p class="text-muted hint-note">
            The page loads in a frame (A38) — the tile's own space, or the
            modal's wide row, as this slot's destination says.
          </p>
        </div>
      {:else if matches.length === 0}
        <p class="empty text-muted">No matching states.</p>
      {:else}
        <ul class="list">
          {#each matches as s (s.id)}
            <li>
              <button type="button" class="row" onclick={() => pickState(s)}>
                <span class="name">{stateName(s)}</span>
                <span class="meta text-muted">{s.id}</span>
                <span class="value text-muted">{stateValue(s.id)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="actions">
      <span class="text-muted"
        >{isSource ? "Returns the source string" : "Adds to this tile"}</span
      >
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
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(720px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tab {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    cursor: pointer;
  }

  .tab:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
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

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background-color: var(--surface-container);
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

  .value {
    font-size: 0.75rem;
    max-width: 25%;
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

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
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
