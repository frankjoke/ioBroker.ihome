<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconPicker from "$lib/components/common/IconPicker.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import {
    POOL_CAP,
    clearBaseOverride,
    filterPoolIcons,
    poolEntries,
    removePoolIcon,
    setBaseOverride,
    upsertPoolIcon,
    type IconPool,
    type PoolEntry,
    type PoolIcon,
  } from "$lib/config/icon-pool";
  import { PRESETS } from "$lib/config/presets";
  import {
    commitIconPool,
    getIconPool,
    iconPoolLoadKind,
    iconPoolSaveFailed,
    initIconPool,
    isIconPoolWritable,
    reloadIconPool,
  } from "$lib/stores/icon-pool.svelte";
  import {
    getTemplateRegistry,
    initTemplates,
  } from "$lib/stores/templates.svelte.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { newId } from "$lib/utils/ids";
  import { nextAfterRemoval } from "$lib/utils/list-selection";

  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  type PickerTarget = {
    id: string;
    builtin: boolean;
    field: "value" | "activeValue";
  };

  let loaded = $state(false);
  let draft = $state<IconPool>({ version: 1, updatedAt: 0, icons: [] });
  let baseUpdatedAt = $state(0);
  let search = $state("");
  /** The Base section's own open state; a row click must not re-close it. */
  let baseOpen = $state(false);
  let openId = $state<string | null>(null);
  let pendingRemove = $state<PoolEntry | null>(null);
  let pickerOpen = $state(false);
  let pickerTarget = $state<PickerTarget | null>(null);
  let hint = $state("");
  let conflict = $state("");
  let savedHint = $state("");
  let saving = $state(false);
  let keywordDraft = $state("");
  let roleChoices = $state<{ value: string; label: string }[]>([]);
  let started = false;

  const loadKind = $derived(iconPoolLoadKind());
  const writable = $derived(isIconPoolWritable());
  const saveFailed = $derived(iconPoolSaveFailed());
  const baseEntries = $derived(
    poolEntries({
      version: 1,
      updatedAt: 0,
      icons: [],
      overrides: draft.overrides,
    }),
  );
  // The draft, not `poolEntries`: an entry being edited must stay visible even
  // while its name is empty or stops matching the search.
  const rows = $derived.by<PoolEntry[]>(() => {
    const all: PoolEntry[] = [...baseEntries, ...draft.icons];
    const filtered = filterPoolIcons(all, search);
    if (!openId || filtered.some((entry) => entry.id === openId)) {
      return filtered;
    }
    const open = all.find((entry) => entry.id === openId);
    return open ? [...filtered, open] : filtered;
  });
  const baseRows = $derived(rows.filter((entry) => entry.builtin));
  const userRows = $derived(rows.filter((entry) => !entry.builtin));
  const openBase = $derived(
    openId ? baseEntries.find((entry) => entry.id === openId) : undefined,
  );
  const openUser = $derived(
    openId ? draft.icons.find((icon) => icon.id === openId) : undefined,
  );
  const openEntry = $derived(openBase ?? openUser);

  const templateOptions = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const options: { value: string; label: string }[] = [];
    for (const template of getTemplateRegistry().templates ?? []) {
      if (seen.has(template.id)) continue;
      seen.add(template.id);
      options.push({ value: template.id, label: template.name });
    }
    for (const template of Object.values(PRESETS)) {
      if (seen.has(template.id)) continue;
      seen.add(template.id);
      options.push({ value: template.id, label: `${template.name} (preset)` });
    }
    return options;
  });

  const keywordChoices = $derived.by(() => {
    if (!openUser) return [];
    const current = new SvelteSet(
      (openUser.keywords ?? []).map((word) => word.toLowerCase()),
    );
    const seen = new SvelteSet<string>();
    const words: string[] = [];
    for (const entry of [...baseEntries, ...draft.icons]) {
      for (const word of entry.keywords ?? []) {
        const lower = word.toLowerCase();
        if (current.has(lower) || seen.has(lower)) continue;
        seen.add(lower);
        words.push(word);
      }
    }
    return words.sort((a, b) => a.localeCompare(b));
  });

  function clonePool(pool: IconPool): IconPool {
    return JSON.parse(JSON.stringify(pool)) as IconPool;
  }

  function buildRoleChoices(): void {
    const counts = new SvelteMap<string, number>();
    for (const object of ioBroker.objects.values()) {
      const record = object as {
        type?: string;
        common?: { role?: string };
      };
      // Only state roles can be a tile headline; channels/folders are noise.
      if (record.type !== "state") continue;
      const role = record.common?.role;
      if (typeof role === "string" && role.trim()) {
        counts.set(role, (counts.get(role) ?? 0) + 1);
      }
    }
    const families = new SvelteMap<string, number>();
    for (const [role, count] of counts) {
      const dot = role.indexOf(".");
      if (dot > 0) {
        const family = `${role.slice(0, dot)}.*`;
        families.set(family, (families.get(family) ?? 0) + count);
      }
    }
    roleChoices = [
      ...[...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([role, count]) => ({ value: role, label: `${role} · ${count}` })),
      ...[...families]
        .sort((a, b) => b[1] - a[1])
        .map(([family, count]) => ({
          value: family,
          label: `${family} · ${count}`,
        })),
    ];
  }

  /** The object cache fills after the socket connects; retry until it has roles. */
  async function fillRoleChoices(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      buildRoleChoices();
      if (roleChoices.length) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  $effect(() => {
    if (started) return;
    started = true;
    void Promise.allSettled([initIconPool(), initTemplates()]).then(() => {
      void fillRoleChoices();
      draft = clonePool(getIconPool());
      baseUpdatedAt = draft.updatedAt;
      loaded = true;
    });
  });

  $effect(() => {
    // A search is a request to see the matches, not a latch on the section.
    if (search.trim()) baseOpen = true;
  });

  $effect(() => {
    dirty =
      loaded &&
      (saveFailed ||
        JSON.stringify([draft.icons, draft.overrides ?? {}]) !==
          JSON.stringify([getIconPool().icons, getIconPool().overrides ?? {}]));
  });

  function entryById(id: string, builtin: boolean): PoolEntry | undefined {
    return builtin
      ? baseEntries.find((entry) => entry.id === id)
      : draft.icons.find((icon) => icon.id === id);
  }

  function updateUser(patch: Partial<PoolIcon>): void {
    const user = openUser;
    if (!user || !writable) return;
    draft = {
      ...draft,
      icons: draft.icons.map((icon) =>
        icon.id === user.id ? { ...icon, ...patch } : icon,
      ),
    };
    savedHint = "";
  }

  function addKeyword(): void {
    const user = openUser;
    const word = keywordDraft.trim();
    if (!user || !writable || !word) return;
    if (
      (user.keywords ?? []).some(
        (item) => item.toLowerCase() === word.toLowerCase(),
      )
    ) {
      keywordDraft = "";
      return;
    }
    updateUser({ keywords: [...(user.keywords ?? []), word] });
    keywordDraft = "";
  }

  function removeKeyword(word: string): void {
    const user = openUser;
    if (!user || !writable) return;
    const keywords = (user.keywords ?? []).filter((item) => item !== word);
    updateUser({ keywords: keywords.length ? keywords : undefined });
  }

  function templateName(id: string): string {
    return templateOptions.find((option) => option.value === id)?.label ?? id;
  }

  function claimConflict(): string | null {
    const templates = new SvelteMap<string, string>();
    const roles = new SvelteMap<string, string>();
    for (const icon of draft.icons) {
      for (const id of icon.templates ?? []) {
        if (templates.has(id)) {
          return `The template “${templateName(id)}” is assigned to both “${templates.get(id)}” and “${icon.name.trim() || "an icon"}”.`;
        }
        templates.set(id, icon.name.trim() || "an icon");
      }
      for (const key of icon.roles ?? []) {
        if (roles.has(key)) {
          return `The role “${key}” is assigned to both “${roles.get(key)}” and “${icon.name.trim() || "an icon"}”.`;
        }
        roles.set(key, icon.name.trim() || "an icon");
      }
    }
    return null;
  }

  function defaultTaken(id: string, value: string): boolean {
    return [...baseEntries, ...draft.icons].some(
      (entry) => entry.id !== id && entry.value === value,
    );
  }

  function applyPick(
    value: string,
    meta?: { name?: string; group?: string; active?: string },
  ): void {
    const target = pickerTarget;
    if (!target || !writable) return;
    pickerTarget = null;
    hint = "";
    savedHint = "";
    const active = (meta?.active ?? "").trim();
    if (target.field === "activeValue") {
      setActiveValue(target, (meta?.active ?? value).trim());
      return;
    }
    const glyph = value.trim();
    // A default icon cannot be empty; Clear in the picker is a no-op here.
    if (!glyph) return;
    if (defaultTaken(target.id, glyph)) {
      hint = "Another pool icon already uses that icon.";
      return;
    }
    if (target.builtin) {
      draft = setBaseOverride(draft, target.id, {
        value: glyph,
        ...(active ? { activeValue: active } : {}),
      });
    } else {
      draft = {
        ...draft,
        icons: draft.icons.map((icon) =>
          icon.id === target.id
            ? {
                ...icon,
                value: glyph,
                ...(active ? { activeValue: active } : {}),
              }
            : icon,
        ),
      };
    }
  }

  function setActiveValue(target: PickerTarget, value: string): void {
    if (!writable) return;
    const activeValue = value.trim() || undefined;
    if (target.builtin) {
      draft = setBaseOverride(draft, target.id, { activeValue });
    } else {
      draft = {
        ...draft,
        icons: draft.icons.map((icon) =>
          icon.id === target.id ? { ...icon, activeValue } : icon,
        ),
      };
    }
    savedHint = "";
  }

  function resetBase(entry: PoolEntry): void {
    if (!writable) return;
    if (!draft.overrides?.[entry.id]) {
      hint = "This base icon already uses its default.";
      return;
    }
    draft = clearBaseOverride(draft, entry.id);
    savedHint = "";
  }

  function addIcon(
    value: string,
    meta?: { name?: string; group?: string },
  ): void {
    // The picker's Clear returns ""; it is not an icon to add.
    if (!writable || !value.trim()) return;
    if (
      [...baseEntries, ...draft.icons].some((entry) => entry.value === value)
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
    search = "";
    hint = "";
    savedHint = "";
  }

  function remove(entry: PoolEntry): void {
    if (!writable) return;
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
    const overrides = draft.overrides;
    return {
      version: 1,
      updatedAt: draft.updatedAt,
      icons: draft.icons.map((icon) => {
        const keywords = (icon.keywords ?? [])
          .map((word) => word.trim())
          .filter(Boolean);
        const activeValue = icon.activeValue?.trim();
        return {
          id: icon.id,
          name: icon.name.trim(),
          value: icon.value.trim(),
          ...(activeValue ? { activeValue } : {}),
          ...(icon.templates?.length ? { templates: icon.templates } : {}),
          ...(icon.roles?.length ? { roles: icon.roles } : {}),
          ...(icon.group?.trim() ? { group: icon.group.trim() } : {}),
          ...(keywords.length ? { keywords } : {}),
        };
      }),
      ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
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
      hint = "The icon pool is not writable.";
      return;
    }
    if (draft.icons.some((icon) => !icon.name.trim() || !icon.value.trim())) {
      hint = "Every icon needs a name and an icon.";
      return;
    }
    const duplicate = claimConflict();
    if (duplicate) {
      hint = duplicate;
      return;
    }
    const next: IconPool = { ...cleanDraft(), updatedAt: Date.now() };
    const snapshot = JSON.stringify([next.icons, next.overrides ?? {}]);
    saving = true;
    const result = await commitIconPool(next, baseUpdatedAt);
    saving = false;
    if (result === "saved") {
      baseUpdatedAt = next.updatedAt;
      // Keep edits made while the write was in flight.
      if (JSON.stringify([draft.icons, draft.overrides ?? {}]) === snapshot) {
        draft = clonePool(next);
      }
      savedHint = "Saved.";
    } else if (result === "conflict") {
      conflict = "The icon pool changed in another tab. Reload before saving.";
    } else {
      hint = "The icon pool could not be saved.";
    }
  }
</script>

{#snippet poolRow(entry: PoolEntry, builtin: boolean)}
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
        {entry.name}
      </button>
      {#if builtin}<span class="badge">built-in</span>{/if}
      {#if entry.group}<span class="badge">{entry.group}</span>{/if}
      {#each entry.templates ?? [] as id (id)}
        <span class="badge auto-badge" title="Template default"
          >{templateName(id)}</span
        >
      {/each}
      {#each entry.roles ?? [] as role (role)}
        <span class="badge auto-badge" title="Role default">{role}</span>
      {/each}
      {#if !builtin || openId === entry.id}
        <span class="item-actions">
          {#if openId === entry.id}
            <!-- One document: this row's Save writes the whole pool. -->
            <button
              type="button"
              class="btn btn-primary btn-sm"
              title="Save the whole icon pool"
              disabled={!dirty || !writable || saving}
              onclick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          {/if}
          {#if !builtin}
            <IconButton
              icon="delete"
              danger
              label={`Delete ${entry.name}`}
              disabled={!writable}
              onclick={() => (pendingRemove = entry)}
            />
          {/if}
        </span>
      {/if}
    </div>
    {#if openId === entry.id && openEntry}
      <div class="item-editor pool-editor">
        <div class="icon-pair">
          <div class="icon-slot">
            <span class="label-mono">Default</span>
            <button
              type="button"
              class="btn btn-sm glyph-pick"
              title={`Change the default icon of ${entry.name}`}
              aria-label={`Change the default icon of ${entry.name}`}
              disabled={!writable}
              onclick={() =>
                (pickerTarget = { id: entry.id, builtin, field: "value" })}
            >
              <Icon value={openEntry.value} size={18} />
            </button>
          </div>
          <div class="icon-slot">
            <span class="label-mono">Active</span>
            <div class="active-line">
              <button
                type="button"
                class="btn btn-sm glyph-pick"
                title={`Set the active icon of ${entry.name}`}
                aria-label={`Set the active icon of ${entry.name}`}
                disabled={!writable}
                onclick={() =>
                  (pickerTarget = {
                    id: entry.id,
                    builtin,
                    field: "activeValue",
                  })}
              >
                {#if openEntry.activeValue}
                  <Icon value={openEntry.activeValue} size={18} />
                {:else}
                  <span class="material-symbols-outlined">add</span>
                {/if}
              </button>
              {#if openEntry.activeValue}
                <IconButton
                  icon="close"
                  label={`Clear the active icon of ${entry.name}`}
                  disabled={!writable}
                  onclick={() =>
                    setActiveValue(
                      { id: entry.id, builtin, field: "activeValue" },
                      "",
                    )}
                />
              {/if}
            </div>
          </div>
          {#if builtin}
            <button
              type="button"
              class="btn btn-outline btn-sm reset-btn"
              disabled={!writable}
              onclick={() => resetBase(entry)}>Reset</button
            >
          {/if}
        </div>
        {#if !builtin}
          <div class="pool-fields">
            <label class="field">
              <span class="label-mono">Name</span>
              <input
                type="text"
                value={openEntry.name}
                disabled={!writable}
                oninput={(e) => updateUser({ name: e.currentTarget.value })}
              />
            </label>
            <label class="field">
              <span class="label-mono">Group</span>
              <input
                type="text"
                value={openEntry.group ?? ""}
                disabled={!writable}
                onchange={(e) =>
                  updateUser({
                    group: e.currentTarget.value.trim() || undefined,
                  })}
              />
            </label>
            <div class="field keywords">
              <span class="label-mono">Keywords</span>
              <div class="keyword-chips">
                {#each openEntry.keywords ?? [] as word (word)}
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
              <p class="hint text-muted">Search only — never changes a tile.</p>
            </div>
          </div>
          <div class="auto-picks">
            <div class="field">
              <span class="label-mono">Applies to templates</span>
              <MultiSelect
                options={templateOptions}
                selected={openEntry.templates ?? []}
                placeholder="No template default"
                onChange={(values) =>
                  updateUser({
                    templates: values.length ? values : undefined,
                  })}
              />
              <p class="hint text-muted">
                Automatic face default for tiles from these templates.
              </p>
            </div>
            <div class="field">
              <span class="label-mono">Roles</span>
              <MultiSelect
                options={roleChoices}
                selected={openEntry.roles ?? []}
                placeholder="No role default"
                onChange={(values) =>
                  updateUser({ roles: values.length ? values : undefined })}
              />
              <p class="hint text-muted">
                Fallback by the headline control's ioBroker role (exact, then
                family).
              </p>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if !loaded}
  <div class="card empty-state">
    <p class="text-muted">
      {loadKind === "unreadable"
        ? "The icon pool document is unreadable. Fix or remove ihome.0.config.iconPool before editing."
        : "Loading icon pool…"}
    </p>
  </div>
{:else if loadKind === "pending"}
  <div class="card empty-state">
    <p class="text-muted">The icon pool could not be loaded.</p>
    <button type="button" class="btn btn-outline btn-sm" onclick={reload}>
      Retry
    </button>
  </div>
{:else}
  <div class="icon-pool-page">
    <div class="item">
      <div class="item-line title-line">
        <Icon value="apps" size={18} />
        <span class="name">Icon pool</span>
        <span class="badge">{draft.icons.length} added</span>
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
          placeholder="Search name, group or keywords…"
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
          <details class="base-group" bind:open={baseOpen}>
            <summary class="label-mono">
              Base icons ({baseRows.length}) · device types and roles
            </summary>
            <p class="hint text-muted">
              Base catalog — picking is copy-on-pick. Automatic defaults live on
              your entries.
            </p>
            {#each baseRows as entry (entry.id)}
              {@render poolRow(entry, true)}
            {/each}
          </details>
        {/if}

        {#each userRows as entry (entry.id)}
          {@render poolRow(entry, false)}
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

{#if pickerTarget}
  <IconPicker
    manage
    icon={entryById(pickerTarget.id, pickerTarget.builtin)?.[
      pickerTarget.field
    ]}
    onPick={applyPick}
    onClose={() => (pickerTarget = null)}
  />
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

  .reset-btn {
    margin-bottom: 2px;
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

  .auto-picks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  @media (max-width: 820px) {
    .auto-picks {
      grid-template-columns: 1fr;
    }
  }
</style>
