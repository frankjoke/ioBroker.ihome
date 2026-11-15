<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import {
    POOL_CAP,
    emptyIconPool,
    filterLibrary,
    keywordWords,
    libraryKeywordCounts,
    removeLibraryIcon,
    upsertLibraryIcon,
    type IconPool,
    type LibraryIcon,
  } from "$lib/config/icon-library";
  import {
    commitIconPool,
    getIconPool,
    iconPoolLoadKind,
    iconPoolSaveFailed,
    initIconPool,
    isIconPoolWritable,
    reloadIconPool,
  } from "$lib/stores/icon-pool.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { newId } from "$lib/utils/ids";
  import { nextAfterRemoval } from "$lib/utils/list-selection";

  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  type PickerTarget = { id: string; field: "value" | "activeValue" };

  const TABS = [
    { id: "library", label: "Library", hint: "Your curated icons" },
  ] as const;

  let loaded = $state(false);
  let tab = $state<"library">("library");
  let draft = $state<IconPool>(emptyIconPool());
  let baseUpdatedAt = $state(0);
  let search = $state("");
  let openId = $state<string | null>(null);
  let pendingRemove = $state<LibraryIcon | null>(null);
  let pickerOpen = $state(false);
  let pickerTarget = $state<PickerTarget | null>(null);
  let hint = $state("");
  let conflict = $state("");
  let savedHint = $state("");
  let saving = $state(false);
  let keywordDraft = $state("");
  let started = false;

  const loadKind = $derived(iconPoolLoadKind());
  const writable = $derived(isIconPoolWritable());
  const saveFailed = $derived(iconPoolSaveFailed());

  // The draft, not the filtered list: an entry being edited must stay visible
  // even while its name stops matching the search.
  const rows = $derived.by<LibraryIcon[]>(() => {
    const filtered = filterLibrary(draft.library, [], search);
    if (!openId || filtered.some((entry) => entry.id === openId)) {
      return filtered;
    }
    const open = draft.library.find((entry) => entry.id === openId);
    return open ? [...filtered, open] : filtered;
  });
  const openIcon = $derived(
    openId ? draft.library.find((icon) => icon.id === openId) : undefined,
  );
  const keywordChoices = $derived.by(() => {
    const current = new Set(openIcon?.keywords ?? []);
    return libraryKeywordCounts(draft.library)
      .map((entry) => entry.keyword)
      .filter((word) => !current.has(word));
  });

  function clonePool(pool: IconPool): IconPool {
    return JSON.parse(JSON.stringify(pool)) as IconPool;
  }

  $effect(() => {
    if (started) return;
    started = true;
    void initIconPool().then(() => {
      draft = clonePool(getIconPool());
      baseUpdatedAt = draft.updatedAt;
      loaded = true;
    });
  });

  $effect(() => {
    dirty =
      loaded &&
      (saveFailed ||
        JSON.stringify([draft.library, draft.defaults]) !==
          JSON.stringify([getIconPool().library, getIconPool().defaults]));
  });

  function updateIcon(patch: Partial<LibraryIcon>): void {
    const icon = openIcon;
    if (!icon || !writable) return;
    draft = upsertLibraryIcon(draft, { ...icon, ...patch });
    savedHint = "";
  }

  function addKeyword(): void {
    const icon = openIcon;
    if (!icon || !writable) return;
    const words = keywordWords(keywordDraft).filter(
      (word) => !icon.keywords.includes(word),
    );
    keywordDraft = "";
    if (!words.length) return;
    updateIcon({ keywords: [...icon.keywords, ...words] });
  }

  function removeKeyword(word: string): void {
    const icon = openIcon;
    if (!icon || !writable) return;
    updateIcon({ keywords: icon.keywords.filter((item) => item !== word) });
  }

  function defaultTaken(id: string, value: string): boolean {
    return draft.library.some(
      (entry) => entry.id !== id && entry.value === value,
    );
  }

  function applyPick(
    value: string,
    meta?: { name?: string; active?: string },
  ): void {
    const target = pickerTarget;
    if (!target || !writable) return;
    pickerTarget = null;
    hint = "";
    savedHint = "";
    if (target.field === "activeValue") {
      setActive(target.id, (meta?.active ?? value).trim());
      return;
    }
    const glyph = value.trim();
    // A default icon cannot be empty; Clear in the picker is a no-op here.
    if (!glyph) return;
    const icon = draft.library.find((entry) => entry.id === target.id);
    if (!icon) return;
    if (defaultTaken(target.id, glyph)) {
      hint = "Another library icon already uses that icon.";
      return;
    }
    const active = (meta?.active ?? "").trim();
    draft = upsertLibraryIcon(draft, {
      ...icon,
      value: glyph,
      ...(active ? { activeValue: active } : {}),
    });
  }

  function setActive(id: string, value: string): void {
    if (!writable) return;
    const icon = draft.library.find((entry) => entry.id === id);
    if (!icon) return;
    const activeValue = value.trim() || undefined;
    draft = upsertLibraryIcon(draft, {
      ...icon,
      ...(activeValue ? { activeValue } : { activeValue: undefined }),
    });
    savedHint = "";
  }

  function addIcon(
    value: string,
    meta?: { name?: string; group?: string; active?: string },
  ): void {
    // The picker's Clear returns ""; it is not an icon to add.
    if (!writable || !value.trim()) return;
    if (draft.library.some((entry) => entry.value === value)) {
      pickerOpen = false;
      hint = "That icon is already in the library.";
      return;
    }
    if (draft.library.length >= POOL_CAP) {
      hint = `The library is full (${POOL_CAP} icons).`;
      return;
    }
    pickerOpen = false;
    const name = meta?.name?.trim() || undefined;
    const icon: LibraryIcon = {
      id: newId(),
      ...(name ? { name } : {}),
      value,
      ...(meta?.active?.trim() ? { activeValue: meta.active.trim() } : {}),
      keywords: keywordWords(
        [meta?.name, meta?.group].filter(Boolean).join(" ") || value,
      ),
    };
    draft = upsertLibraryIcon(draft, icon);
    openId = icon.id;
    search = "";
    hint = "";
    savedHint = "";
  }

  function remove(entry: LibraryIcon): void {
    if (!writable) return;
    const next = nextAfterRemoval(draft.library, entry.id, (icon) => icon.id);
    draft = removeLibraryIcon(draft, entry.id);
    pendingRemove = null;
    openId = next?.id ?? null;
    savedHint = "";
  }

  function onLineClick(event: MouseEvent, entry: LibraryIcon): void {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    )
      return;
    openId = openId === entry.id ? null : entry.id;
  }

  function cleanDraft(): IconPool {
    return {
      version: 2,
      updatedAt: draft.updatedAt,
      library: draft.library.map((icon) => {
        const keywords = [
          ...new Set(icon.keywords.flatMap((word) => keywordWords(word))),
        ];
        const name = icon.name?.trim();
        const activeValue = icon.activeValue?.trim();
        return {
          id: icon.id,
          ...(name ? { name } : {}),
          value: icon.value.trim(),
          ...(activeValue ? { activeValue } : {}),
          keywords,
        };
      }),
      defaults: draft.defaults,
    };
  }

  async function reload(): Promise<void> {
    await reloadIconPool();
    draft = clonePool(getIconPool());
    baseUpdatedAt = draft.updatedAt;
    conflict = "";
    hint = "";
    savedHint = "";
  }

  async function save(): Promise<void> {
    if (saving) return;
    hint = "";
    savedHint = "";
    conflict = "";
    if (!writable) {
      hint = "The icon library is not writable.";
      return;
    }
    if (draft.library.some((icon) => !icon.value.trim())) {
      hint = "Every icon needs an icon.";
      return;
    }
    const next: IconPool = { ...cleanDraft(), updatedAt: Date.now() };
    const snapshot = JSON.stringify([next.library, next.defaults]);
    saving = true;
    const result = await commitIconPool(next, baseUpdatedAt);
    saving = false;
    if (result === "saved") {
      baseUpdatedAt = next.updatedAt;
      // Keep edits made while the write was in flight.
      if (JSON.stringify([draft.library, draft.defaults]) === snapshot) {
        draft = clonePool(next);
      }
      savedHint = "Saved.";
    } else if (result === "conflict") {
      conflict =
        "The icon library changed in another tab. Reload before saving.";
    } else {
      hint = "The icon library could not be saved.";
    }
  }

  function label(icon: LibraryIcon): string {
    return icon.name?.trim() || icon.value;
  }
</script>

{#snippet libraryRow(entry: LibraryIcon)}
  <div class="item" class:open={openId === entry.id}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="item-line" onclick={(event) => onLineClick(event, entry)}>
      <Icon value={entry.value} size={18} />
      {#if entry.activeValue}
        <span class="row-twin" title="Active icon">
          <Icon value={entry.activeValue} size={18} />
        </span>
      {/if}
      <button
        type="button"
        class="name"
        aria-expanded={openId === entry.id}
        onclick={() => (openId = openId === entry.id ? null : entry.id)}
      >
        {label(entry)}
      </button>
      {#each entry.keywords.slice(0, 4) as word (word)}
        <span class="badge">{word}</span>
      {/each}
      <span class="item-actions">
        {#if openId === entry.id}
          <!-- One document: this row's Save writes the whole library. -->
          <button
            type="button"
            class="btn btn-primary btn-sm"
            title="Save the whole icon library"
            disabled={!dirty || !writable || saving}
            onclick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        {/if}
        <IconButton
          icon="delete"
          danger
          label={`Delete ${label(entry)}`}
          disabled={!writable}
          onclick={() => (pendingRemove = entry)}
        />
      </span>
    </div>
    {#if openId === entry.id && openIcon}
      <div class="item-editor pool-editor">
        <div class="icon-pair">
          <div class="icon-slot">
            <span class="label-mono">Default</span>
            <button
              type="button"
              class="btn btn-sm glyph-pick"
              title={`Change the default icon of ${label(entry)}`}
              aria-label={`Change the default icon of ${label(entry)}`}
              disabled={!writable}
              onclick={() => (pickerTarget = { id: entry.id, field: "value" })}
            >
              <Icon value={openIcon.value} size={18} />
            </button>
          </div>
          <div class="icon-slot">
            <span class="label-mono">Active</span>
            <div class="active-line">
              <button
                type="button"
                class="btn btn-sm glyph-pick"
                title={`Set the active icon of ${label(entry)}`}
                aria-label={`Set the active icon of ${label(entry)}`}
                disabled={!writable}
                onclick={() =>
                  (pickerTarget = { id: entry.id, field: "activeValue" })}
              >
                {#if openIcon.activeValue}
                  <Icon value={openIcon.activeValue} size={18} />
                {:else}
                  <span class="material-symbols-outlined">add</span>
                {/if}
              </button>
              {#if openIcon.activeValue}
                <IconButton
                  icon="close"
                  label={`Clear the active icon of ${label(entry)}`}
                  disabled={!writable}
                  onclick={() => setActive(entry.id, "")}
                />
              {/if}
            </div>
          </div>
        </div>
        <div class="pool-fields">
          <label class="field">
            <span class="label-mono">Name</span>
            <input
              type="text"
              placeholder="optional"
              value={openIcon.name ?? ""}
              disabled={!writable}
              oninput={(e) => updateIcon({ name: e.currentTarget.value })}
            />
          </label>
          <div class="field keywords">
            <span class="label-mono">Keywords</span>
            <div class="keyword-chips">
              {#each openIcon.keywords as word (word)}
                <span class="keyword-chip">
                  {word}
                  <button
                    type="button"
                    class="chip-x"
                    aria-label={`Remove keyword ${word}`}
                    disabled={!writable}
                    onclick={() => removeKeyword(word)}
                  >
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </span>
              {/each}
            </div>
            <div class="keyword-add">
              <input
                type="text"
                aria-label="Add a keyword"
                placeholder="add a keyword"
                list="icon-keyword-choices"
                bind:value={keywordDraft}
                disabled={!writable}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={!writable || !keywordDraft.trim()}
                onclick={addKeyword}>Add</button
              >
            </div>
            <datalist id="icon-keyword-choices">
              {#each keywordChoices as word (word)}
                <option value={word}></option>
              {/each}
            </datalist>
            <p class="hint text-muted">
              Search only — an icon may carry several keywords.
            </p>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#if !loaded}
  <div class="card empty-state">
    <p class="text-muted">
      {loadKind === "unreadable"
        ? "The icon pool document is unreadable. Fix or remove ihome.0.config.iconPool before editing."
        : "Loading icon library…"}
    </p>
  </div>
{:else if loadKind === "pending"}
  <div class="card empty-state">
    <p class="text-muted">The icon library could not be loaded.</p>
    <button type="button" class="btn btn-outline btn-sm" onclick={reload}>
      Retry
    </button>
  </div>
{:else}
  <div class="icon-pool-page">
    <OptionTabs
      bind:value={tab}
      label="Icon manager"
      tabs={TABS}
      collapsible={false}
      showHint={false}
    />
    <div class="item">
      <div class="item-line title-line">
        <Icon value="apps" size={18} />
        <span class="name">Icon library</span>
        <span class="badge">{draft.library.length} icons</span>
        <!-- Add stays on the document line; Save lives on the open row (§5). -->
        <span class="item-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!writable || saving}
            onclick={() => {
              hint = "";
              savedHint = "";
              pickerOpen = true;
            }}
          >
            + Icon
          </button>
        </span>
      </div>
    </div>

    {#if loadKind === "unreadable"}
      <p class="text-danger hint">
        The icon pool document is unreadable. Its content is never overwritten.
      </p>
    {/if}
    {#if hint}<p class="text-danger hint">{hint}</p>{/if}
    {#if conflict}
      <div class="conflict-line">
        <p class="text-warning hint">{conflict}</p>
        <button type="button" class="btn btn-outline btn-sm" onclick={reload}
          >Reload</button
        >
      </div>
    {/if}
    {#if savedHint}<p class="text-success hint">{savedHint}</p>{/if}
    {#if saveFailed}
      <p class="text-danger hint">Not saved — check the connection.</p>
    {/if}

    <div class="list-toolbar">
      <div class="list-filter">
        <span class="label-mono filter-label">Filters</span>
        <input
          type="search"
          placeholder="Search name, keywords or icon…"
          bind:value={search}
        />
      </div>
    </div>

    {#if rows.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No icons match the search.</p>
      </div>
    {:else}
      <div class="list">
        {#each rows as entry (entry.id)}
          {@render libraryRow(entry)}
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if pickerOpen}
  <IconPicker manage onPick={addIcon} onClose={() => (pickerOpen = false)} />
{/if}

{#if pickerTarget}
  <IconPicker
    manage
    icon={draft.library.find((entry) => entry.id === pickerTarget?.id)?.[
      pickerTarget.field
    ]}
    onPick={applyPick}
    onClose={() => (pickerTarget = null)}
  />
{/if}

{#if pendingRemove}
  <ConfirmModal
    title={deleteTitle("icon", label(pendingRemove))}
    confirmLabel="Delete"
    onConfirm={() => remove(pendingRemove!)}
    onCancel={() => (pendingRemove = null)}
  >
    <p>Only the library row is removed; tiles using the icon keep it.</p>
  </ConfirmModal>
{/if}

<style>
  .icon-pool-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  /* The Templates page's list styles are scoped there; the manager needs its
     own copies. */
  .title-line {
    cursor: default;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .list-toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .list-filter {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto;
    gap: 0.35rem 0.5rem;
  }

  .filter-label {
    grid-column: 1 / -1;
  }

  .list-filter input {
    min-width: 0;
    padding: 0.35rem;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .row-twin {
    display: flex;
    opacity: 0.7;
  }

  .pool-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .icon-pair {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .icon-slot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .active-line {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .glyph-pick .material-symbols-outlined {
    font-size: 18px;
  }

  .conflict-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .conflict-line .hint {
    flex: 1 1 auto;
  }

  .pool-fields {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) minmax(10rem, 1fr);
    gap: 0.5rem;
    align-items: end;
  }

  .pool-fields .keywords {
    grid-column: 1 / -1;
  }

  @media (max-width: 820px) {
    .pool-fields {
      grid-template-columns: 1fr;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .field input {
    width: 100%;
    box-sizing: border-box;
  }

  .keyword-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .keyword-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem 0.3rem 0.1rem 0.55rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .chip-x {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .chip-x .material-symbols-outlined {
    font-size: 15px;
  }

  .keyword-add {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.25rem;
  }

  .keyword-add input {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
