<script lang="ts">
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import NameModal from "$lib/components/common/NameModal.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { newId } from "$lib/utils/ids";
  import { adapterIcon, pluginPageIcon } from "$lib/config/icon-ops";
  import {
    BUILTIN_PAGES,
    adminPageHref,
    type BuiltinPage,
  } from "$lib/config/builtin-pages";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    commitPluginPages,
    getPluginPages,
    initPluginPages,
    isPluginPagesWritable,
    pluginPagesSaveFailed,
  } from "$lib/stores/plugin-pages.svelte";
  import {
    pluginPageHref,
    validPluginPageUrl,
    type PluginPageEntry,
  } from "$lib/config/plugin-pages";

  let {
    canCreate = $bindable(false),
  }: {
    /** Whether the parent's + Page button can open the create dialog. */
    canCreate?: boolean;
  } = $props();

  const pages = $derived(getPluginPages().pages);
  const adminIcon = $derived(
    adapterIcon(ioBroker.objects as Map<string, any>, "admin"),
  );
  type BuiltinRow = BuiltinPage & {
    icon?: { value: string; owner?: string };
  };

  const builtins: BuiltinRow[] = $derived(
    BUILTIN_PAGES.map((page): BuiltinRow =>
      page.id === "admin" ? { ...page, icon: adminIcon } : page,
    ),
  );

  let selectedId = $state("");
  let draft = $state<PluginPageEntry | null>(null);
  let saved = $state<PluginPageEntry | null>(null);
  let askCreate = $state(false);
  let pendingOpen = $state<PluginPageEntry | null>(null);
  let askDiscard = $state(false);
  let pendingDelete = $state<PluginPageEntry | null>(null);
  let message = $state("");
  let messageError = $state(false);

  const dirty = $derived(
    !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved),
  );
  const urlOk = $derived(!!draft && !!validPluginPageUrl(draft.url));
  const canSave = $derived(
    dirty && urlOk && isPluginPagesWritable() && !!draft?.title.trim(),
  );

  $effect(() => {
    canCreate = !dirty && isPluginPagesWritable();
  });

  onMount(() => {
    void initPluginPages();
  });

  function select(page: PluginPageEntry) {
    selectedId = page.id;
    draft = $state.snapshot(page) as PluginPageEntry;
    saved = $state.snapshot(page) as PluginPageEntry;
    message = "";
    messageError = false;
  }

  function togglePage(page: PluginPageEntry) {
    if (selectedId === page.id) {
      close();
      return;
    }
    if (dirty) {
      pendingOpen = page;
      askDiscard = true;
      return;
    }
    select(page);
  }

  function close() {
    if (dirty) {
      askDiscard = true;
      pendingOpen = null;
      return;
    }
    selectedId = "";
    draft = null;
    saved = null;
    message = "";
    messageError = false;
  }

  function discard() {
    askDiscard = false;
    const next = pendingOpen;
    pendingOpen = null;
    if (next) {
      select(next);
      return;
    }
    selectedId = "";
    draft = null;
    saved = null;
    message = "";
    messageError = false;
  }

  function cancelDiscard() {
    askDiscard = false;
    pendingOpen = null;
  }

  /** The free line is a mouse convenience; controls keep their own hit areas. */
  function onLineClick(event: MouseEvent, page: PluginPageEntry) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    togglePage(page);
  }

  function save() {
    if (!draft || !canSave) return;
    const next = pages.map((page) =>
      page.id === draft!.id ? { ...draft! } : page,
    );
    const ok = commitPluginPages({ ...getPluginPages(), pages: next });
    message = ok
      ? "Saved."
      : "Not saved — the page list is unreadable or invalid.";
    messageError = !ok;
    if (ok) saved = { ...draft };
  }

  function remove() {
    if (!pendingDelete) return;
    const page = pendingDelete;
    pendingDelete = null;
    const ok = commitPluginPages({
      ...getPluginPages(),
      pages: pages.filter((entry) => entry.id !== page.id),
    });
    message = ok ? "Deleted." : "Not deleted — the page list is unreadable.";
    messageError = !ok;
    if (ok && selectedId === page.id) {
      selectedId = "";
      draft = null;
      saved = null;
    }
  }

  function add(title: string) {
    // A valid placeholder; the editor's URL field replaces it before use.
    const entry: PluginPageEntry = {
      id: newId(),
      title,
      icon: "web_asset",
      url: "/",
      open: "embed",
    };
    const ok = commitPluginPages({
      ...getPluginPages(),
      pages: [...pages, entry],
    });
    if (!ok) {
      message = "Not saved — the page list is unreadable.";
      messageError = true;
      return;
    }
    askCreate = false;
    select(entry);
  }

  function problem(value: string): string | null {
    const title = value.trim();
    if (!title) return "Enter a name.";
    if (title.length > 64) return "At most 64 characters.";
    if (title.toLowerCase() === "admin") return "That name is already used.";
    if (
      pages.some((page) => page.title.toLowerCase() === title.toLowerCase())
    ) {
      return "That name is already used.";
    }
    return null;
  }

  function openPage(page: PluginPageEntry) {
    if (page.open === "tab") {
      window.open(page.url, "_blank", "noopener");
      return;
    }
    void goto(pluginPageHref(page.id, base));
  }

  export function startCreate() {
    askCreate = true;
  }

  function openBuiltin(tab: string) {
    void goto(
      tab === "overview" ? `${base}/#/admin` : `${base}/#/admin?tab=${tab}`,
    );
  }
</script>

<section class="pages-section">
  {#if !isPluginPagesWritable()}
    <p class="text-danger hint">
      The page list could not be read — nothing is saved. Fix the
      <code>ihome.0.config.pluginPages</code> state first.
    </p>
  {/if}

  <div class="page-list">
    {#each builtins as entry (entry.id)}
      <div class="item">
        <div class="item-line">
          {#if entry.icon}
            <Icon value={entry.icon.value} owner={entry.icon.owner} size={18} />
          {:else if entry.svg}
            <Icon
              value={entry.svg}
              data={{ $color: "var(--text-color)" }}
              size={18}
            />
          {:else}
            <Icon value={entry.glyph ?? "web_asset"} size={18} />
          {/if}
          <span class="name static-name">{entry.title}</span>
          <span class="badge badge-secondary">built-in</span>
          <span class="meta mono">{entry.meta}</span>
          <span class="item-actions">
            <IconButton
              icon="open_in_new"
              label={`Open ${entry.title}`}
              onclick={() => openBuiltin(entry.tab)}
            />
          </span>
        </div>
      </div>
    {/each}

    {#each pages as page (page.id)}
      {@const open = selectedId === page.id}
      {@const pageIcon = pluginPageIcon(
        ioBroker.objects as Map<string, any>,
        page,
      )}
      <div class="item" class:open>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(event) => onLineClick(event, page)}>
          <Icon
            value={pageIcon?.value ?? "web_asset"}
            owner={pageIcon?.owner}
            size={18}
          />
          <button
            type="button"
            class="name"
            aria-expanded={open}
            onclick={() => togglePage(page)}
          >
            {page.title}
          </button>
          <span class="badge"
            >{page.open === "tab" ? "new tab" : "embedded"}</span
          >
          <span class="meta mono">{page.url}</span>
          <span class="item-actions">
            {#if open}
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={!canSave}
                onclick={save}>Save</button
              >
            {/if}
            <IconButton
              icon="open_in_new"
              label={`Open ${page.title}`}
              onclick={() => openPage(page)}
            />
            <IconButton
              icon="delete"
              label={`Delete ${page.title}`}
              danger
              onclick={() => (pendingDelete = page)}
            />
          </span>
        </div>

        {#if open && draft}
          <div class="item-editor">
            <div class="fields">
              <label class="field">
                <span class="label-mono">Name</span>
                <input type="text" bind:value={draft.title} maxlength="64" />
              </label>
              <label class="field">
                <span class="label-mono">Icon</span>
                <input
                  type="text"
                  bind:value={draft.icon}
                  maxlength="64"
                  placeholder="web_asset"
                />
              </label>
              <label class="field wide">
                <span class="label-mono">URL</span>
                <input
                  type="text"
                  bind:value={draft.url}
                  maxlength="512"
                  placeholder="/iqontrol/ or https://…"
                />
                <span class="hint text-muted">
                  Root-relative (/iqontrol/, /ihome/plugin.html) or an absolute
                  http(s) address.
                </span>
              </label>
              <label class="field">
                <span class="label-mono">Open</span>
                <select bind:value={draft.open}>
                  <option value="embed">Embedded in iHome</option>
                  <option value="tab">New tab</option>
                </select>
              </label>
            </div>
            {#if draft.url && !urlOk}
              <p class="text-danger hint">
                The URL must start with / or http(s)://.
              </p>
            {/if}
            {#if message}
              <p class="hint" class:text-danger={messageError}>{message}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    {#if pages.length === 0}
      <p class="hint text-muted">No custom pages yet.</p>
    {/if}
  </div>

  {#if pluginPagesSaveFailed()}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
</section>

{#if askCreate}
  <NameModal
    title="New page"
    label="Page name"
    confirmLabel="Create"
    validate={problem}
    onSubmit={(name) => add(name)}
    onCancel={() => (askCreate = false)}
  />
{/if}

{#if askDiscard}
  <ConfirmModal
    title="Discard unsaved changes?"
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={discard}
    onCancel={cancelDiscard}
  />
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("page", pendingDelete.title)}
    confirmLabel="Delete"
    onConfirm={remove}
    onCancel={() => (pendingDelete = null)}
  >
    <p class="text-muted">
      The page is removed from the cog menu; no file is deleted.
    </p>
  </ConfirmModal>
{/if}

<style>
  .pages-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .page-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .static-name {
    font-weight: 600;
  }

  .meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .field.wide {
    grid-column: 1 / -1;
  }

  .field input,
  .field select {
    width: 100%;
    box-sizing: border-box;
  }
</style>
