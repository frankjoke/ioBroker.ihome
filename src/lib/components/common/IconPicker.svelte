<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import { base } from "$app/paths";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { initIconPool, getIconPool } from "$lib/stores/icon-pool.svelte";
  import {
    filterPoolIcons,
    mdiIconValue,
    poolEntries,
  } from "$lib/config/icon-pool";
  import { collectDocumentIcons, isImageIcon } from "$lib/utils/icon-url";
  import { iconTitle, isHtmlIcon } from "$lib/config/icon-html";
  import { brokerIconPath } from "$lib/config/icon-ops";
  import { TEMPERATURE_ICON } from "$lib/config/presets";
  import Icon from "$lib/components/common/Icon.svelte";

  let {
    icon = undefined,
    onPick,
    onClose,
    manage = false,
  }: {
    /** The current value, for highlighting and the URL prefill. */
    icon?: string;
    /** The picked value; "" clears the icon. */
    onPick: (
      icon: string,
      meta?: { name?: string; group?: string; active?: string },
    ) => void;
    onClose: () => void;
    /** The manager's picker: the full source browser (Symbols, Document,
     *  Broker, MDI). Consumers get Pool + URL/SVG only. */
    manage?: boolean;
  } = $props();

  const TABS = [
    { id: "pool", label: "Pool" },
    { id: "symbols", label: "Symbols" },
    { id: "document", label: "Used in UI" },
    { id: "broker", label: "Broker" },
    { id: "url", label: "URL / SVG / HTML" },
    { id: "mdi", label: "MDI" },
  ] as const;

  /** Consumers see the curated pool, the icons already used in pages/templates
   *  (a local walk, no source scan), and a one-off URL. Only the manager browses
   *  the source libraries. */
  const visibleTabs = $derived(
    manage
      ? TABS
      : TABS.filter(
          (entry) =>
            entry.id === "pool" ||
            entry.id === "document" ||
            entry.id === "url",
        ),
  );

  /** Ready-made icon markup: the slot's reading, its resolved colour and its
   *  on/off state (the snippet's own CSS switches on `data-on`). */
  const SNIPPETS = [
    {
      id: "battery",
      label: "Battery",
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="{{$color}}" stroke-width="1.5"><rect x="2" y="7" width="18" height="10" rx="2"/><rect x="20" y="10" width="2" height="4" rx="0.5" fill="{{$color}}" stroke="none"/><svg x="4" y="9" width="14" height="6"><rect width="{{$value}}%" height="6" fill="{{$color}}" stroke="none"/></svg></svg>`,
    },
    {
      id: "gauge",
      label: "Gauge",
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="{{$color}}" stroke-width="2" stroke-linecap="round"><path d="M4 17a8 8 0 0 1 16 0" opacity="0.2"/><path d="M4 17a8 8 0 0 1 16 0" pathLength="100" stroke-dasharray="{{$value}} 100"/><path d="M4 17h1M19 17h1M12 9v1" stroke-width="1" opacity="0.5"/></svg>`,
    },
    {
      id: "bar",
      label: "Bar",
      html: `<svg viewBox="0 0 24 24"><rect x="2" y="9" width="20" height="6" rx="3" fill="none" stroke="{{$color}}" stroke-width="1.5"/><svg x="4" y="11" width="16" height="2"><rect width="{{$value}}%" height="2" rx="1" fill="{{$color}}"/></svg></svg>`,
    },
    {
      id: "power",
      label: "Power",
      html: `<style>.on{display:none}[data-on="true"] .on{display:inline}[data-on="true"] .off{display:none}</style><svg viewBox="0 0 24 24" fill="none" stroke="{{$color}}" stroke-width="1.8" stroke-linecap="round"><g class="off"><path d="M12 3v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></g><g class="on"><circle cx="12" cy="13" r="8" fill="{{$color}}" stroke="none" opacity="0.18"/><path d="M12 3v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></g></svg>`,
    },
    {
      id: "bulb",
      label: "Bulb",
      html: `<style>:root{--bulb:#b8860b}.on{display:none}[data-on="true"] .on{display:inline}[data-on="true"] .off{display:none}</style><svg viewBox="0 0 24 24" fill="none" stroke="{{$color}}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g class="off"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.3 1.5 1.4 2.5h5.2c.1-1 .6-1.8 1.4-2.5A6 6 0 0 0 12 3z"/></g><g class="on"><path d="M9 18h6M10 21h4" stroke="{{$color}}"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.3 1.5 1.4 2.5h5.2c.1-1 .6-1.8 1.4-2.5A6 6 0 0 0 12 3z" fill="var(--bulb)" fill-opacity="0.65" stroke="var(--bulb)"/><path d="M12 3V1M5.5 4.5 4.3 3.3M18.5 4.5 19.7 3.3M3 11h2M19 11h2" stroke="var(--bulb)" stroke-width="1.4"/></g></svg>`,
    },
    {
      id: "temperature",
      label: "Temperature",
      html: TEMPERATURE_ICON,
    },
  ] as const;

  let tab = $state<(typeof TABS)[number]["id"]>("pool");
  let search = $state("");
  // The picker is mounted fresh per open, so capturing the initial value is the
  // point; a later `icon` change never arrives while it is up.
  // svelte-ignore state_referenced_locally
  let url = $state(icon && (isImageIcon(icon) || isHtmlIcon(icon)) ? icon : "");

  // The symbol list is a large JSON: only the manager's Symbols tab loads it.
  let symbolNames = $state.raw<string[]>([]);
  let symbolsLoading = $state(false);
  let symbolsError = $state("");
  let symbolsStarted = false;

  /** The first 120 matches — the full list is thousands long. */
  const matches = $derived(
    symbolNames
      .filter((n) => !search.trim() || n.includes(search.trim().toLowerCase()))
      .slice(0, 120),
  );

  async function loadSymbols(): Promise<void> {
    if (symbolsStarted) return;
    symbolsStarted = true;
    symbolsLoading = true;
    symbolsError = "";
    try {
      const mod = await import("$lib/assets/material-symbol-names.json");
      const names = (mod as { default?: unknown }).default;
      if (!Array.isArray(names)) {
        throw new Error("unexpected symbol list");
      }
      symbolNames = names as string[];
    } catch (e) {
      symbolsStarted = false;
      symbolsError = e instanceof Error ? e.message : String(e);
    } finally {
      symbolsLoading = false;
    }
  }

  $effect(() => {
    if (tab === "symbols" && manage) void loadSymbols();
  });

  const pool = $derived(poolEntries(getIconPool()));
  const poolShown = $derived(filterPoolIcons(pool, search));

  $effect(() => {
    if (tab === "pool") void initIconPool();
  });

  type MdiIcon = {
    id: string;
    p: string;
    c: string;
    n: Record<string, string>;
  };
  type MdiCategory = { id: string; name: Record<string, string> };

  // Imported once and never edited: raw avoids deep-proxying ~5000 objects.
  let mdiIcons = $state.raw<MdiIcon[]>([]);
  let mdiCategories = $state.raw<MdiCategory[]>([]);
  let mdiLoading = $state(false);
  let mdiError = $state("");
  let mdiCategory = $state("");
  let mdiStarted = false;

  const mdiCategoryName = (id: string) =>
    mdiCategories.find((category) => category.id === id)?.name?.en ?? id;

  const mdiShown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return mdiIcons
      .filter((icon) => {
        if (mdiCategory && icon.c !== mdiCategory) return false;
        if (!q) return true;
        return `${icon.id} ${icon.n?.en ?? ""} ${mdiCategoryName(icon.c)}`
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 120);
  });

  async function loadMdi(): Promise<void> {
    if (mdiStarted) return;
    mdiStarted = true;
    mdiLoading = true;
    mdiError = "";
    try {
      const url = new URL("icon-library.js", document.baseURI).href;
      const mod = (await import(/* @vite-ignore */ url)) as {
        ICON_LIBRARY: MdiIcon[];
        ICON_LIBRARY_CATEGORIES: MdiCategory[];
      };
      if (
        !Array.isArray(mod.ICON_LIBRARY) ||
        !Array.isArray(mod.ICON_LIBRARY_CATEGORIES)
      ) {
        throw new Error("icon-library.js has an unexpected shape");
      }
      mdiIcons = mod.ICON_LIBRARY;
      mdiCategories = mod.ICON_LIBRARY_CATEGORIES;
    } catch (e) {
      mdiStarted = false;
      mdiError = e instanceof Error ? e.message : String(e);
    } finally {
      mdiLoading = false;
    }
  }

  $effect(() => {
    if (tab === "mdi" && manage) void loadMdi();
  });

  // Both source scans run only while their (manager-only) tab is open.
  const documentIcons = $derived(
    tab === "document"
      ? collectDocumentIcons(getPageRegistry(), getTemplateRegistry())
      : [],
  );

  /** Every `common.icon` the broker has, deduped by value (one id shown). */
  const brokerIcons = $derived.by(() => {
    if (tab !== "broker") return [];
    const seen = new SvelteMap<string, string>();
    for (const [id, obj] of (ioBroker.objects as Map<string, any>) ?? []) {
      const value = obj?.common?.icon;
      if (typeof value === "string" && value.trim() && !seen.has(value)) {
        seen.set(value, id);
      }
    }
    return [...seen.entries()]
      .map(([value, id]) => ({ value, id }))
      .sort((a, b) => a.value.localeCompare(b.value));
  });

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label="Choose an icon">
  <div class="modal-content">
    <div class="modal-head">
      <h3>Choose an icon</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="option-tabs" role="tablist">
      {#each visibleTabs as t (t.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          class="option-tab"
          class:active={tab === t.id}
          onclick={() => {
            tab = t.id;
            search = "";
          }}>{t.label}</button
        >
      {/each}
    </div>

    {#if tab === "symbols"}
      <input type="search" placeholder="Search symbols…" bind:value={search} />
    {:else if tab === "pool"}
      <input type="search" placeholder="Search the pool…" bind:value={search} />
    {:else if tab === "mdi"}
      <input
        type="search"
        placeholder="Search MDI icons…"
        bind:value={search}
      />
    {/if}

    <div class="results">
      {#if tab === "pool"}
        {#if poolShown.length === 0}
          <p class="empty text-muted">No icons match the search.</p>
        {:else}
          <ul class="list">
            {#each poolShown as entry (`${entry.builtin ? "b" : "u"}:${entry.id}`)}
              <li>
                <div class="pool-row">
                  <button
                    type="button"
                    class="row-btn pool-main"
                    class:current={entry.value === icon}
                    title={entry.name}
                    onclick={() =>
                      onPick(entry.value, {
                        name: entry.name,
                        group: entry.group,
                        active: entry.activeValue,
                      })}
                  >
                    <Icon value={entry.value} size={22} />
                    <span class="value">{entry.name}</span>
                    {#if entry.builtin}
                      <span class="pool-badge">built-in</span>
                    {/if}
                    {#if entry.templates?.length || entry.roles?.length}
                      <span
                        class="pool-badge auto"
                        title={`Automatic default for ${[
                          ...(entry.templates ?? []),
                          ...(entry.roles ?? []),
                        ].join(", ")}`}>auto</span
                      >
                    {/if}
                    {#if entry.group}
                      <span class="meta text-muted">{entry.group}</span>
                    {/if}
                  </button>
                  {#if entry.activeValue}
                    <button
                      type="button"
                      class="pool-twin-btn"
                      class:current={entry.activeValue === icon}
                      title={`Use the active icon of ${entry.name}`}
                      aria-label={`Use the active icon of ${entry.name}`}
                      onclick={() =>
                        onPick(entry.activeValue!, {
                          name: entry.name,
                          group: entry.group,
                        })}
                    >
                      <Icon value={entry.activeValue} size={20} />
                      <span class="pool-twin-label">active</span>
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if !manage && pool.every((entry) => entry.builtin)}
          <p class="empty text-muted">
            No added icons yet — expand the pool in Templates → Icons.
          </p>
        {/if}
        {#if !manage}
          <a
            class="btn btn-outline btn-sm manage-link"
            href={`${base}/#/templates?type=icons`}
            target="_blank"
            rel="noopener">Manage icons</a
          >
        {/if}
      {:else if tab === "symbols"}
        {#if symbolsLoading}
          <p class="empty text-muted">Loading symbols…</p>
        {:else if symbolsError}
          <p class="empty text-danger">
            Symbols failed to load: {symbolsError}
          </p>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            onclick={() => {
              symbolsStarted = false;
              void loadSymbols();
            }}>Retry</button
          >
        {:else if matches.length === 0}
          <p class="empty text-muted">No matching symbols.</p>
        {:else}
          <div class="grid">
            {#each matches as name (name)}
              <button
                type="button"
                class="cell"
                class:current={name === icon}
                title={name}
                aria-label={name}
                onclick={() => onPick(name)}
              >
                <Icon value={name} size={22} />
              </button>
            {/each}
          </div>
        {/if}
      {:else if tab === "document"}
        {#if documentIcons.length === 0}
          <p class="empty text-muted">
            No icons are used in the pages or templates yet.
          </p>
        {:else}
          <div class="grid">
            {#each documentIcons as value (value)}
              <button
                type="button"
                class="cell"
                class:current={value === icon}
                title={iconTitle(value)}
                aria-label={value}
                onclick={() => onPick(value)}
              >
                <Icon {value} size={22} />
              </button>
            {/each}
          </div>
        {/if}
      {:else if tab === "broker"}
        {#if brokerIcons.length === 0}
          <p class="empty text-muted">
            No broker objects carry a <code>common.icon</code>.
          </p>
        {:else}
          <ul class="list">
            {#each brokerIcons as entry (entry.value)}
              <li>
                <button
                  type="button"
                  class="row-btn"
                  class:current={entry.value === icon}
                  onclick={() => onPick(brokerIconPath(entry.value, entry.id))}
                >
                  <Icon value={entry.value} owner={entry.id} size={22} />
                  <span class="value">{entry.value}</span>
                  <span class="meta text-muted">{entry.id}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if tab === "mdi" && manage}
        {#if mdiLoading}
          <p class="empty text-muted">Loading MDI icons…</p>
        {:else if mdiError}
          <p class="empty text-danger">MDI icons failed to load: {mdiError}</p>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            onclick={() => {
              mdiStarted = false;
              void loadMdi();
            }}>Retry</button
          >
        {:else}
          <label class="mdi-category">
            <span class="label-mono">Category</span>
            <select bind:value={mdiCategory}>
              <option value="">All categories</option>
              {#each mdiCategories as category (category.id)}
                <option value={category.id}
                  >{category.name?.en ?? category.id}</option
                >
              {/each}
            </select>
          </label>
          {#if mdiShown.length === 0}
            <p class="empty text-muted">No matching MDI icons.</p>
          {:else}
            <div class="grid">
              {#each mdiShown as entry (entry.id)}
                <button
                  type="button"
                  class="cell"
                  title={entry.n?.en ?? entry.id}
                  aria-label={entry.n?.en ?? entry.id}
                  onclick={() =>
                    onPick(mdiIconValue(entry.p), {
                      name: entry.n?.en ?? entry.id,
                      group: mdiCategoryName(entry.c),
                    })}
                >
                  <Icon value={mdiIconValue(entry.p)} size={22} />
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      {:else}
        <div class="snippets">
          <span class="label-mono">Snippets</span>
          {#each SNIPPETS as snippet (snippet.id)}
            <button
              type="button"
              class="btn btn-sm"
              onclick={() => (url = snippet.html)}>{snippet.label}</button
            >
          {/each}
        </div>
        <div class="url-row">
          <textarea
            rows="5"
            placeholder="https://…, adapter/name.png, data:image/svg+xml,… or <svg>…"
            bind:value={url}
          ></textarea>
          <span class="preview" aria-hidden="true">
            <Icon value={url} size={22} data={{ $value: 50, $on: true }} />
          </span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!url.trim()}
            onclick={() => onPick(url.trim())}>Use</button
          >
        </div>
        <p class="hint text-muted">
          SVG/HTML fragments fill the icon box.
          <span class="mono">&#123;&#123;$value&#125;&#125;</span> is the slot's
          reading, <span class="mono">&#123;&#123;$color&#125;&#125;</span> its resolved
          colour. Power and Bulb switch themselves by `data-on`; the preview uses
          50 and the on state.
        </p>
      {/if}
    </div>

    <div class="actions">
      <button type="button" class="btn" onclick={() => onPick("")}>Clear</button
      >
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .option-tabs {
    --option-tab-bg: var(--surface-color);
  }

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
    width: min(560px, 100%);
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

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    border-radius: var(--border-radius-sm, 4px);
    color: var(--text-muted);
    cursor: pointer;
  }

  .cell:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .cell.current {
    background-color: var(--primary-container);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row-btn:hover {
    background-color: var(--surface-container);
  }

  .row-btn.current {
    background-color: var(--primary-container);
  }

  .value {
    font-size: var(--body-sm);
    white-space: nowrap;
  }

  .pool-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
  }

  .pool-main {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
  }

  .pool-main .value {
    flex: 1 1 auto;
    min-width: 0;
    white-space: normal;
  }

  .pool-twin-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex: 0 0 auto;
    padding: 0.15rem 0.45rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .pool-twin-btn:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .pool-twin-btn.current {
    background-color: var(--primary-container);
    color: var(--text-color);
    border-color: var(--primary-color);
  }

  .pool-twin-label {
    font-size: var(--label-mono-size);
  }

  .pool-badge.auto {
    color: var(--primary-color);
    border-color: var(--primary-color);
  }

  .pool-badge {
    flex: 0 0 auto;
    font-size: var(--label-mono-size);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.3rem;
  }

  .manage-link {
    margin-top: 0.5rem;
  }

  .meta {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
  }

  .mdi-category {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
  }

  .snippets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .url-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .url-row textarea {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 5rem;
    padding: 0.35rem;
    font-family: var(--font-family);
    font-size: var(--body-sm);
    resize: vertical;
  }

  .hint {
    margin: 0.35rem 0 0;
    font-size: var(--body-sm);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    color: var(--text-muted);
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
