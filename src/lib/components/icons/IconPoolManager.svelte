<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import {
    BUILTIN_POOL,
    POOL_CAP,
    filterPoolIcons,
    removePoolIcon,
    upsertPoolIcon,
    type IconPool,
    type PoolEntry,
    type PoolIcon,
  } from "$lib/config/icon-pool";
  import {
    commitIconPool,
    getIconPool,
    iconPoolLoadKind,
    iconPoolSaveFailed,
    initIconPool,
    isIconPoolWritable,
  } from "$lib/stores/icon-pool.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { newId } from "$lib/utils/ids";
  import { nextAfterRemoval } from "$lib/utils/list-selection";

  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  let loaded = $state(false);
  let draft = $state<IconPool>({ version: 1, updatedAt: 0, icons: [] });
  let baseUpdatedAt = $state(0);
  let search = $state("");
  let openId = $state<string | null>(null);
  let pendingRemove = $state<PoolEntry | null>(null);
  let pickerOpen = $state(false);
  let hint = $state("");
  let conflict = $state("");
  let savedHint = $state("");
  let started = false;

  const loadKind = $derived(iconPoolLoadKind());
  const writable = $derived(isIconPoolWritable());
  const saveFailed = $derived(iconPoolSaveFailed());
  // The draft, not `poolEntries`: an entry being edited must stay visible even
  // while its name is empty, or clearing the field would delete the row.
  const rows = $derived(
    filterPoolIcons([...BUILTIN_POOL, ...draft.icons], search),
  );
  const baseRows = $derived(rows.filter((entry) => entry.builtin));
  const userRows = $derived(rows.filter((entry) => !entry.builtin));
  const openIcon = $derived(
    openId ? draft.icons.find((icon) => icon.id === openId) : undefined,
  );

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
        JSON.stringify(draft.icons) !== JSON.stringify(getIconPool().icons));
  });

  function updateIcon(patch: Partial<PoolIcon>): void {
    if (!openId) return;
    draft = {
      ...draft,
      icons: draft.icons.map((icon) =>
        icon.id === openId ? { ...icon, ...patch } : icon,
      ),
    };
    savedHint = "";
  }

  function setKeywords(value: string): void {
    const keywords = value
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    updateIcon({ keywords: keywords.length ? keywords : undefined });
  }

  function addIcon(
    value: string,
    meta?: { name?: string; group?: string },
  ): void {
    // The picker's Clear returns ""; it is not an icon to add.
    if (!value.trim()) return;
    if (
      [...BUILTIN_POOL, ...draft.icons].some((entry) => entry.value === value)
    ) {
      pickerOpen = false;
      hint = "That icon is already in the pool.";
      return;
    }
    if (draft.icons.length >= POOL_CAP) {
      hint = `The pool is full (${POOL_CAP} icons).`;
      return;
    }
    pickerOpen = false;
    const icon: PoolIcon = {
      id: newId(),
      name: meta?.name?.trim() || "Icon",
      value,
      ...(meta?.group?.trim() ? { group: meta.group.trim() } : {}),
    };
    draft = upsertPoolIcon(draft, icon);
    openId = icon.id;
    hint = "";
    savedHint = "";
  }

  function remove(entry: PoolEntry): void {
    const next = nextAfterRemoval(draft.icons, entry.id, (icon) => icon.id);
    draft = removePoolIcon(draft, entry.id);
    pendingRemove = null;
    openId = next?.id ?? null;
    savedHint = "";
  }

  function onLineClick(event: MouseEvent, entry: PoolEntry): void {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    )
      return;
    openId = openId === entry.id ? null : entry.id;
  }

  function cleanDraft(): IconPool {
    return {
      version: 1,
      updatedAt: draft.updatedAt,
      icons: draft.icons.map((icon) => {
        const keywords = (icon.keywords ?? [])
          .map((word) => word.trim())
          .filter(Boolean);
        return {
          id: icon.id,
          name: icon.name.trim(),
          value: icon.value.trim(),
          ...(icon.group?.trim() ? { group: icon.group.trim() } : {}),
          ...(keywords.length ? { keywords } : {}),
        };
      }),
    };
  }

  async function save(): Promise<void> {
    hint = "";
    savedHint = "";
    conflict = "";
    if (!writable) {
      hint = "The icon pool is not writable.";
      return;
    }
    if (draft.icons.some((icon) => !icon.name.trim() || !icon.value.trim())) {
      hint = "Every icon needs a name and an icon.";
      return;
    }
    if (getIconPool().updatedAt !== baseUpdatedAt) {
      conflict = "The icon pool changed in another tab. Reload before saving.";
      return;
    }
    const next: IconPool = { ...cleanDraft(), updatedAt: Date.now() };
    const ok = await commitIconPool(next);
    draft = clonePool(next);
    baseUpdatedAt = next.updatedAt;
    if (ok) savedHint = "Saved.";
    else hint = "The icon pool could not be saved.";
  }
</script>

{#if !loaded}
  <div class="card empty-state">
    <p class="text-muted">
      {loadKind === "unreadable"
        ? "The icon pool document is unreadable. Fix or remove ihome.0.config.iconPool before editing."
        : "Loading icon pool…"}
    </p>
  </div>
{:else}
  <div class="icon-pool-page">
    <div class="item">
      <div class="item-line title-line">
        <Icon value="apps" size={18} />
        <span class="name">Icon pool</span>
        <span class="badge">{draft.icons.length} added</span>
        <!-- UI-DESIGN §5 exception: the pool is one document, so Add/Save live
             once in the header instead of on each open row. -->
        <span class="item-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!writable || loadKind === "unreadable"}
            onclick={() => {
              hint = "";
              savedHint = "";
              pickerOpen = true;
            }}
          >
            <span class="material-symbols-outlined">add</span> Icon
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!dirty || !writable || loadKind === "unreadable"}
            onclick={save}
          >
            <span class="material-symbols-outlined">save</span> Save
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
    {#if conflict}<p class="text-warning hint">{conflict}</p>{/if}
    {#if savedHint}<p class="text-success hint">{savedHint}</p>{/if}
    {#if saveFailed}
      <p class="text-danger hint">Not saved — the broker is unreachable.</p>
    {/if}

    <div class="list-toolbar">
      <div class="list-filter">
        <span class="label-mono filter-label">Filters</span>
        <input
          type="search"
          placeholder="Search name or group…"
          bind:value={search}
        />
      </div>
    </div>

    {#if userRows.length === 0 && baseRows.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No icons match the search.</p>
      </div>
    {:else}
      <div class="list">
        {#if baseRows.length > 0}
          <details class="base-group" open={search.trim().length > 0}>
            <summary class="label-mono">
              Base icons ({baseRows.length}) · device types and roles
            </summary>
            {#each baseRows as entry (entry.id)}
              <div class="item">
                <div class="item-line">
                  <Icon value={entry.value} size={18} />
                  <span class="name">{entry.name}</span>
                  <span class="badge">built-in</span>
                  {#if entry.group}
                    <span class="meta text-muted">{entry.group}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </details>
        {/if}

        {#each userRows as entry (entry.id)}
          <div class="item" class:open={openId === entry.id}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="item-line"
              onclick={(event) => onLineClick(event, entry)}
            >
              <Icon value={entry.value} size={18} />
              <button
                type="button"
                class="name"
                aria-expanded={openId === entry.id}
                onclick={() => (openId = openId === entry.id ? null : entry.id)}
              >
                {entry.name}
              </button>
              {#if entry.group}<span class="badge">{entry.group}</span>{/if}
              <span class="item-actions">
                <IconButton
                  icon="delete"
                  danger
                  label={`Delete ${entry.name}`}
                  onclick={() => (pendingRemove = entry)}
                />
              </span>
            </div>
            {#if openId === entry.id && openIcon}
              <div class="item-editor pool-editor">
                <div class="pool-preview">
                  <Icon value={openIcon.value} size={32} />
                </div>
                <label class="field">
                  <span class="label-mono">Name</span>
                  <input
                    type="text"
                    value={openIcon.name}
                    oninput={(e) => updateIcon({ name: e.currentTarget.value })}
                  />
                </label>
                <label class="field">
                  <span class="label-mono">Group</span>
                  <input
                    type="text"
                    value={openIcon.group ?? ""}
                    onchange={(e) =>
                      updateIcon({
                        group: e.currentTarget.value.trim() || undefined,
                      })}
                  />
                </label>
                <label class="field">
                  <span class="label-mono">Keywords</span>
                  <input
                    type="text"
                    value={(openIcon.keywords ?? []).join(", ")}
                    placeholder="comma separated"
                    onchange={(e) => setKeywords(e.currentTarget.value)}
                  />
                </label>
              </div>
            {/if}
          </div>
        {/each}
        {#if draft.icons.length === 0}
          <p class="hint text-muted">
            No added icons yet — the base icons are always available. Use
            <strong>+ Icon</strong> to expand the pool.
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if pickerOpen}
  <IconPicker manage onPick={addIcon} onClose={() => (pickerOpen = false)} />
{/if}

{#if pendingRemove}
  <ConfirmModal
    title={deleteTitle("icon", pendingRemove.name)}
    confirmLabel="Delete"
    onConfirm={() => remove(pendingRemove!)}
    onCancel={() => (pendingRemove = null)}
  >
    <p>Only the pool entry is removed; tiles using the icon keep it.</p>
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

  .base-group {
    margin-bottom: 0.25rem;
  }

  .base-group summary {
    cursor: pointer;
    padding: 0.35rem 0.5rem;
    color: var(--secondary-color);
  }

  .pool-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
  }

  .pool-editor {
    display: grid;
    grid-template-columns: auto minmax(10rem, 1fr) minmax(10rem, 1fr) minmax(
        12rem,
        1.5fr
      );
    gap: 0.5rem;
    align-items: end;
  }

  @media (max-width: 820px) {
    .pool-editor {
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
</style>
