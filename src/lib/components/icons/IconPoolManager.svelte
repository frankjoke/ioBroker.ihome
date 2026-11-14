<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import {
    BUILTIN_POOL,
    filterPoolIcons,
    poolEntries,
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
  import { newId } from "$lib/utils/ids";

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
  const rows = $derived(filterPoolIcons(poolEntries(draft), search));
  const baseRows = $derived(rows.filter((entry) => entry.builtin));
  const userRows = $derived(rows.filter((entry) => !entry.builtin));
  const openIcon = $derived(
    openId ? draft.icons.find((icon) => icon.id === openId) : undefined,
  );

  $effect(() => {
    if (started) return;
    started = true;
    void initIconPool().then(() => {
      draft = structuredClone(getIconPool());
      baseUpdatedAt = draft.updatedAt;
      loaded = true;
    });
  });

  $effect(() => {
    dirty =
      loaded &&
      JSON.stringify(draft.icons) !== JSON.stringify(getIconPool().icons);
  });

  function updateIcon(patch: Partial<PoolIcon>): void {
    if (!openId) return;
    draft = {
      ...draft,
      icons: draft.icons.map((icon) =>
        icon.id === openId ? { ...icon, ...patch } : icon,
      ),
    };
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
    pickerOpen = false;
    if (poolEntries(draft).some((entry) => entry.value === value)) {
      hint = "That icon is already in the pool.";
      return;
    }
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
    draft = removePoolIcon(draft, entry.id);
    pendingRemove = null;
    if (openId === entry.id) openId = null;
    savedHint = "";
  }

  function save(): void {
    hint = "";
    savedHint = "";
    conflict = "";
    if (!writable) {
      hint = "The icon pool is not writable.";
      return;
    }
    if (getIconPool().updatedAt !== baseUpdatedAt) {
      conflict = "The icon pool changed in another tab. Reload before saving.";
      return;
    }
    const next: IconPool = { ...draft, version: 1, updatedAt: Date.now() };
    if (!commitIconPool(next)) {
      hint = "The icon pool could not be saved.";
      return;
    }
    draft = structuredClone(next);
    baseUpdatedAt = next.updatedAt;
    savedHint = "Saved.";
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
      <div class="item-line">
        <Icon value="apps" size={18} />
        <span class="name">Icon pool</span>
        <span class="badge">{draft.icons.length} added</span>
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
            <div class="item-line">
              <Icon value={entry.value} size={18} />
              <button
                type="button"
                class="name"
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
                    oninput={(e) =>
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
                    oninput={(e) => setKeywords(e.currentTarget.value)}
                  />
                </label>
              </div>
            {/if}
          </div>
        {/each}
        {#if userRows.length === 0}
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
    title={`Delete “${pendingRemove.name}”?`}
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
    gap: 4px;
    min-width: 0;
  }

  .field input {
    width: 100%;
    box-sizing: border-box;
  }
</style>
