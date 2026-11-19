<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
  import {
    filterLibrary,
    libraryKeywordCounts,
    offTwin,
    pairChoices,
    splitTwins,
    addLibraryValue,
  } from "$lib/config/icon-library";
  import { getIconPool, initIconPool } from "$lib/stores/icon-pool.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { collectDocumentIcons, isImageIcon } from "$lib/utils/icon-url";
  import { isHtmlIcon } from "$lib/config/icon-html";
  import { writeIconFile } from "$lib/config/icon-files";
  import IconImporter from "$lib/components/icons/IconImporter.svelte";
  import IconPoolManager from "$lib/components/icons/IconPoolManager.svelte";
  import {
    commitIconPool,
    isIconPoolWritable,
  } from "$lib/stores/icon-pool.svelte";

  /** The one editor picker: the library, narrowed by keywords. The main tile
   *  icon may pick an on/off pair; every other consumer sees the same grid. */
  let {
    icon = undefined,
    onPick,
    onClose,
    twins = false,
  }: {
    /** The current value, for marking and the custom prefill. */
    icon?: string;
    /** The picked value; "" clears the icon. `active` comes with a pair. */
    onPick: (value: string, meta?: { active?: string }) => void;
    onClose: () => void;
    /** Twin-aware consumers group the `twins` map into an On/Off block. */
    twins?: boolean;
  } = $props();

  let search = $state("");
  let selected = $state<string[]>([]);
  let inUse = $state(false);
  let customOpen = $state(false);
  let uploadError = $state("");
  let mode = $state<"icons" | "browse" | "manage">("icons");
  let browseHint = $state("");
  let manageDirty = $state(false);
  let manager = $state<{ save: () => Promise<boolean> }>();
  let pending = $state<"icons" | "browse" | "manage" | "close" | null>(null);
  let savingGuard = $state(false);
  // svelte-ignore state_referenced_locally
  let url = $state(icon && (isImageIcon(icon) || isHtmlIcon(icon)) ? icon : "");

  /** A local image (svg/png/…), stored in the shared space. */
  function onFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    uploadError = "";
    if (file.size > 10_000_000) {
      uploadError = "The image is larger than 10 MB.";
      return;
    }
    void writeIconFile(file)
      .then((value) => onPick(value))
      .catch(() => {
        uploadError = "The image could not be stored.";
      });
  }

  $effect(() => {
    void initIconPool();
  });

  const library = $derived(getIconPool().library);
  const keywordCounts = $derived(libraryKeywordCounts(library));
  const inUseValues = $derived(
    new Set(
      collectDocumentIcons(getPageRegistry(), getTemplateRegistry()),
    ) as Set<string>,
  );
  const shown = $derived.by(() => {
    const list = filterLibrary(library, selected, search);
    return inUse ? list.filter((entry) => inUseValues.has(entry.value)) : list;
  });
  const split = $derived(splitTwins(shown, getIconPool().twins));
  const pairs = $derived(split.pairs);
  const singles = $derived(split.singles);
  const twinOf = (value: string): string | undefined =>
    getIconPool().twins[value];

  function toggleKeyword(word: string): void {
    selected = selected.includes(word)
      ? selected.filter((item) => item !== word)
      : [...selected, word];
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // A nested manager importer handles its own Escape; don't close both.
    if (document.querySelector('[aria-label="Add icons"]')) return;
    requestClose();
  }

  function go(next: "icons" | "browse" | "manage"): void {
    if (next === mode) return;
    if (mode === "manage" && manageDirty) {
      pending = next;
      return;
    }
    mode = next;
  }

  function requestClose(): void {
    if (mode === "manage" && manageDirty) {
      pending = "close";
      return;
    }
    onClose();
  }

  function resume(): void {
    const next = pending;
    pending = null;
    if (next === "close") onClose();
    else if (next) mode = next;
  }

  async function saveAndLeave(): Promise<void> {
    savingGuard = true;
    const saved = await manager?.save();
    savingGuard = false;
    // A conflict or a failed save keeps the prompt and its message.
    if (saved) resume();
  }

  function rememberBrowsed(
    value: string,
    meta?: { name?: string; keywords?: string[] },
  ): void {
    if (!isIconPoolWritable()) {
      browseHint = "The icon is not saved in the library.";
      return;
    }
    const next = addLibraryValue(getIconPool(), value, meta);
    if (!next.added) return;
    void commitIconPool(next.pool, getIconPool().updatedAt).then((status) => {
      if (status !== "saved") {
        browseHint = "The icon was picked, but the library was not saved.";
      }
    });
  }

  function pickBrowsed(
    value: string,
    meta: { keywords: string[]; name: string },
  ): void {
    rememberBrowsed(value, meta);
    const pool = getIconPool();
    const active = twins && offTwin(pool.twins, value);
    if (active) {
      onPick(active, { active: value });
      return;
    }
    const twin = twins ? pool.twins[value] : undefined;
    onPick(value, twin ? { active: twin } : undefined);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label="Choose an icon">
  <div class="modal-content" class:wide={mode !== "icons"}>
    <div class="modal-head">
      <h3>Choose an icon</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={requestClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="modes">
      <button
        type="button"
        class:active={mode === "icons"}
        onclick={() => go("icons")}>Icons</button
      >
      <button
        type="button"
        class:active={mode === "browse"}
        onclick={() => go("browse")}>Browse</button
      >
      <button
        type="button"
        class:active={mode === "manage"}
        onclick={() => go("manage")}>Manage</button
      >
    </div>

    {#if mode === "icons"}
      <input type="search" placeholder="Search keywords…" bind:value={search} />

      <div class="chips">
        <button
          type="button"
          class="chip"
          class:active={inUse}
          title="Only icons already used in pages or templates"
          onclick={() => (inUse = !inUse)}
        >
          In use
        </button>
        {#each keywordCounts as entry (entry.keyword)}
          <button
            type="button"
            class="chip"
            class:active={selected.includes(entry.keyword)}
            onclick={() => toggleKeyword(entry.keyword)}
          >
            {entry.keyword}
            <span class="chip-count">{entry.count}</span>
          </button>
        {/each}
      </div>

      <div class="results">
        <button type="button" class="none" onclick={() => onPick("")}
          >None — clear the icon</button
        >

        {#if icon && !shown.some((entry) => entry.value === icon || twinOf(entry.value) === icon)}
          <p class="label-mono group-title">Current</p>
          <div class="grid">
            <button
              type="button"
              class="cell current"
              title={icon}
              aria-label="Current icon"
              onclick={() => onPick(icon ?? "")}
            >
              <Icon value={icon} size={22} />
            </button>
          </div>
        {/if}

        {#if pairs.length > 0}
          <p class="label-mono group-title">On / Off pairs</p>
          <div class="grid">
            {#each pairs as entry (entry.id)}
              {@const twin = twinOf(entry.value)}
              {#each pairChoices(entry.value, twin, twins) as choice, index (choice.value)}
                <button
                  type="button"
                  class="cell"
                  class:current={choice.value === icon ||
                    choice.active === icon}
                  title={choice.active
                    ? `${entry.name ?? entry.value} (pair)`
                    : `Use the ${index === 0 ? "off" : "on"} icon`}
                  aria-label={choice.active
                    ? `${entry.name ?? entry.value} (pair)`
                    : `Use the ${index === 0 ? "off" : "on"} icon`}
                  onclick={() =>
                    onPick(
                      choice.value,
                      choice.active ? { active: choice.active } : undefined,
                    )}
                >
                  <Icon value={choice.value} size={22} />
                </button>
              {/each}
            {/each}
          </div>
        {/if}

        {#if singles.length > 0}
          <p class="label-mono group-title">Icons</p>
          <div class="grid">
            {#each singles as entry (entry.id)}
              <button
                type="button"
                class="cell"
                class:current={entry.value === icon}
                title={entry.name ?? entry.value}
                aria-label={entry.name ?? entry.value}
                onclick={() => onPick(entry.value)}
              >
                <Icon value={entry.value} size={22} />
              </button>
            {/each}
          </div>
        {/if}

        {#if pairs.length === 0 && singles.length === 0}
          <div class="empty text-muted">
            <p>No icons match.</p>
            <span class="empty-actions">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onclick={() => go("browse")}>Browse sources</button
              >
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onclick={() => go("manage")}>Manage library</button
              >
            </span>
          </div>
        {/if}
      </div>

      <div class="foot">
        <button
          type="button"
          class="btn btn-outline btn-sm"
          onclick={() => (customOpen = !customOpen)}>Custom…</button
        >
        {#if customOpen}
          <div class="custom">
            <input
              type="text"
              aria-label="Custom icon"
              placeholder="URL, path, SVG or HTML"
              bind:value={url}
            />
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={!url.trim()}
              onclick={() => onPick(url.trim())}>Use</button
            >
          </div>
          <div class="custom">
            <label class="upload">
              <input type="file" accept="image/*,.svg" onchange={onFile} />
              <span class="btn btn-outline btn-sm">Upload image…</span>
            </label>
          </div>
          {#if uploadError}
            <p class="text-danger upload-error">{uploadError}</p>
          {/if}
        {/if}
      </div>
    {:else if mode === "browse"}
      {#if browseHint}
        <p class="hint text-muted">{browseHint}</p>
      {/if}
      <div class="browse">
        <IconImporter
          embedded
          resources={["mdi", "objects", "adapter"]}
          onPick={pickBrowsed}
          onClose={() => go("icons")}
        />
      </div>
    {:else}
      <div class="manage">
        <IconPoolManager
          embedded
          mode="library"
          bind:this={manager}
          bind:dirty={manageDirty}
        />
      </div>
    {/if}

    {#if pending}
      <div
        class="guard"
        role="alertdialog"
        aria-label="Unsaved library changes"
      >
        <p>Save your library changes first?</p>
        <div class="guard-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={savingGuard}
            onclick={saveAndLeave}
          >
            {savingGuard ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            disabled={savingGuard}
            onclick={resume}>Discard</button
          >
          <button
            type="button"
            class="btn btn-outline btn-sm"
            disabled={savingGuard}
            onclick={() => (pending = null)}>Keep editing</button
          >
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(620px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.6rem;
  }

  .modal-content.wide {
    width: min(860px, 100%);
  }

  .manage {
    min-height: 0;
    overflow: auto;
  }

  .guard {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1010;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    padding: 1rem;
  }

  .guard p {
    margin: 0 0 0.5rem;
  }

  .guard-actions {
    display: flex;
    gap: 0.4rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .modes {
    display: flex;
    gap: 2px;
  }

  .modes button {
    flex: 1;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .modes button.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .empty-actions {
    display: inline-flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .empty p {
    margin: 0 0 0.35rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 6.5rem;
    overflow-y: auto;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .chip.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .chip-count {
    color: var(--text-muted);
    font-size: 10px;
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
    max-height: 55vh;
  }

  .group-title {
    margin: 0.25rem 0 0.2rem;
  }

  .none {
    display: block;
    width: 100%;
    margin-bottom: 0.35rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--body-sm);
    text-align: left;
    cursor: pointer;
  }

  .none:hover {
    color: var(--text-color);
    background-color: var(--surface-container);
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
    width: 38px;
    height: 38px;
    border: 1px solid transparent;
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
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .empty {
    padding: 2rem 1rem;
    text-align: center;
    font-size: var(--body-sm);
  }

  .browse {
    min-height: 0;
    overflow: auto;
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .custom {
    display: flex;
    gap: 0.4rem;
  }

  .custom input[type="text"] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .upload input {
    display: none;
  }

  .upload {
    cursor: pointer;
  }

  .upload-error {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
