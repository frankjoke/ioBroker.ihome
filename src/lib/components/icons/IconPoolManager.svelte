<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconImporter from "$lib/components/icons/IconImporter.svelte";
  import IconDefaults from "$lib/components/icons/IconDefaults.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import {
    POOL_CAP,
    emptyIconPool,
    filterLibraryNames,
    keywordWords,
    libraryKeywordCounts,
    removeLibraryIcon,
    setDefault,
    setTwin,
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

  type Importer =
    { mode: "add" } | { mode: "field"; id: string; field: "value" | "twin" };

  const TABS = [
    { id: "library", label: "Library", hint: "Your curated icons" },
    {
      id: "defaults",
      label: "Defaults",
      hint: "Icons for roles and templates",
    },
  ] as const;

  let loaded = $state(false);
  let tab = $state<"library" | "defaults">("library");
  let draft = $state<IconPool>(emptyIconPool());
  let baseUpdatedAt = $state(0);
  let search = $state("");
  let openId = $state<string | null>(null);
  let pendingRemove = $state<LibraryIcon | null>(null);
  let importer = $state<Importer | null>(null);
  let added = $state(0);
  let skipped = $state(0);
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
    const filtered = filterLibraryNames(draft.library, search);
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
        JSON.stringify([draft.library, draft.twins, draft.defaults]) !==
          JSON.stringify([
            getIconPool().library,
            getIconPool().twins,
            getIconPool().defaults,
          ]));
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

  function importIcon(
    value: string,
    meta: { keywords: string[]; name: string },
  ): void {
    const target = importer;
    if (!target || !writable) return;
    hint = "";
    if (target.mode === "add") {
      if (draft.library.some((entry) => entry.value === value)) {
        skipped += 1;
        return;
      }
      if (draft.library.length >= POOL_CAP) {
        skipped += 1;
        return;
      }
      const name = meta.name?.trim() || undefined;
      const icon: LibraryIcon = {
        id: newId(),
        ...(name ? { name } : {}),
        value,
        keywords: [
          ...new Set([
            ...(meta.keywords ?? []),
            ...keywordWords(meta.name ?? ""),
          ]),
        ],
      };
      draft = upsertLibraryIcon(draft, icon);
      openId = icon.id;
      added += 1;
      savedHint = "";
      return;
    }
    const icon = draft.library.find((entry) => entry.id === target.id);
    if (!icon) return;
    if (target.field === "twin") {
      draft = setTwin(draft, icon.value, value);
      savedHint = "";
      return;
    }
    const glyph = value.trim();
    // A default icon cannot be empty; Clear in the picker is a no-op here.
    if (!glyph) return;
    if (defaultTaken(target.id, glyph)) {
      hint = "Another library icon already uses that icon.";
      return;
    }
    draft = upsertLibraryIcon(draft, { ...icon, value: glyph });
    savedHint = "";
  }

  function closeImporter(): void {
    if (importer?.mode === "add" && (added || skipped)) {
      savedHint = `${added} added${skipped ? `, ${skipped} skipped` : ""}.`;
    }
    importer = null;
    added = 0;
    skipped = 0;
  }

  function setTwinValue(id: string, value: string): void {
    if (!writable) return;
    const icon = draft.library.find((entry) => entry.id === id);
    if (!icon) return;
    draft = setTwin(draft, icon.value, value);
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
      version: 3,
      updatedAt: draft.updatedAt,
      twins: draft.twins,
      library: draft.library.map((icon) => {
        const keywords = [
          ...new Set(icon.keywords.flatMap((word) => keywordWords(word))),
        ];
        const name = icon.name?.trim();
        return {
          id: icon.id,
          ...(name ? { name } : {}),
          value: icon.value.trim(),
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
    const snapshot = JSON.stringify([next.library, next.twins, next.defaults]);
    saving = true;
    const result = await commitIconPool(next, baseUpdatedAt);
    saving = false;
    if (result === "saved") {
      baseUpdatedAt = next.updatedAt;
      // Keep edits made while the write was in flight.
      if (
        JSON.stringify([draft.library, draft.twins, draft.defaults]) ===
        snapshot
      ) {
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

  function setDefaultEntry(
    kind: "roles" | "templates",
    key: string,
    value: string | null,
  ): void {
    if (!writable) return;
    draft = setDefault(draft, kind, key, value);
    savedHint = "";
  }

  function label(icon: LibraryIcon): string {
    return icon.name?.trim() || icon.value;
  }
</script>

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

    {#if tab === "library"}
      <div class="item">
        <div class="item-line title-line">
          <Icon value="apps" size={18} />
          <span class="name">Icon library</span>
          <span class="badge">{draft.library.length} icons</span>
          <!-- Add stays on the document line; Save lives on the open editor (§5). -->
          <span class="item-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={!writable || saving}
              onclick={() => {
                hint = "";
                savedHint = "";
                added = 0;
                skipped = 0;
                importer = { mode: "add" };
              }}
            >
              + Icon
            </button>
          </span>
        </div>
      </div>

      {#if openIcon}
        <div class="item open">
          <div class="item-editor pool-editor">
            <div class="editor-row">
              <div class="icon-slot">
                <span class="label-mono">Default</span>
                <button
                  type="button"
                  class="btn btn-sm glyph-pick"
                  title={`Change the default icon of ${label(openIcon)}`}
                  aria-label={`Change the default icon of ${label(openIcon)}`}
                  disabled={!writable}
                  onclick={() =>
                    (importer = {
                      mode: "field",
                      id: openIcon.id,
                      field: "value",
                    })}
                >
                  <Icon value={openIcon.value} size={18} />
                </button>
              </div>
              <div class="icon-slot">
                <span class="label-mono">Twin (on)</span>
                <div class="active-line">
                  <button
                    type="button"
                    class="btn btn-sm glyph-pick"
                    title={`Set the on-twin of ${label(openIcon)}`}
                    aria-label={`Set the on-twin of ${label(openIcon)}`}
                    disabled={!writable}
                    onclick={() =>
                      (importer = {
                        mode: "field",
                        id: openIcon.id,
                        field: "twin",
                      })}
                  >
                    {#if draft.twins[openIcon.value]}
                      <Icon value={draft.twins[openIcon.value]} size={18} />
                    {:else}
                      <span class="material-symbols-outlined">add</span>
                    {/if}
                  </button>
                  {#if draft.twins[openIcon.value]}
                    <IconButton
                      icon="close"
                      label={`Clear the twin of ${label(openIcon)}`}
                      disabled={!writable}
                      onclick={() => setTwinValue(openIcon!.id, "")}
                    />
                  {/if}
                </div>
              </div>
              <label class="field name-field">
                <span class="label-mono">Name</span>
                <input
                  type="text"
                  placeholder="optional"
                  value={openIcon.name ?? ""}
                  disabled={!writable}
                  oninput={(e) => updateIcon({ name: e.currentTarget.value })}
                />
              </label>
              <span class="item-actions">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  title="Save the whole icon library"
                  disabled={!dirty || !writable || saving}
                  onclick={save}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </span>
            </div>
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
            </div>
          </div>
        </div>
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
        <div class="tiles">
          {#each rows as entry (entry.id)}
            {@const twin = draft.twins[entry.value]}
            <div class="tile" class:current={openId === entry.id}>
              <button
                type="button"
                class="tile-main"
                title={`${label(entry)}${twin ? " (pair)" : ""}`}
                aria-label={`${label(entry)}${twin ? " (pair)" : ""}`}
                aria-pressed={openId === entry.id}
                onclick={() => (openId = openId === entry.id ? null : entry.id)}
              >
                <Icon value={entry.value} size={24} />
                {#if twin}
                  <span class="tile-twin"><Icon value={twin} size={16} /></span>
                {/if}
              </button>
              <IconButton
                icon="delete"
                danger
                label={`Delete ${label(entry)}`}
                disabled={!writable}
                onclick={() => (pendingRemove = entry)}
              />
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <IconDefaults
        {draft}
        {writable}
        {dirty}
        {saving}
        onSet={setDefaultEntry}
        onSave={save}
      />
    {/if}
  </div>
{/if}

{#if importer}
  <IconImporter onPick={importIcon} onClose={closeImporter} />
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

  .pool-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .editor-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .name-field {
    flex: 1 1 12rem;
  }

  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tile {
    position: relative;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-lowest);
  }

  .tile.current {
    border-color: var(--primary-color);
  }

  .tile-main {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .tile-main:hover {
    background-color: var(--surface-container);
  }

  .tile-twin {
    position: absolute;
    left: 1px;
    bottom: 1px;
    display: inline-flex;
    color: var(--text-muted);
    opacity: 0.85;
    pointer-events: none;
  }

  .tile :global(.icon-btn) {
    width: 28px;
    height: 28px;
    opacity: 0.55;
  }

  .tile :global(.icon-btn .material-symbols-outlined) {
    font-size: 17px;
  }

  .tile:hover :global(.icon-btn),
  .tile :global(.icon-btn):focus-visible {
    opacity: 1;
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
