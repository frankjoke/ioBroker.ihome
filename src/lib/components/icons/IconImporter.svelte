<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import { onMount } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getIconPool } from "$lib/stores/icon-pool.svelte";
  import {
    readIconSourcePrefs,
    writeIconSourcePrefs,
  } from "$lib/stores/icon-source-prefs";
  import {
    keywordWords,
    mdiIconValue,
    type LibraryIcon,
  } from "$lib/config/icon-library";
  import {
    iconSourceChoices,
    importValue,
    keywordsFromPath,
    parseListing,
    sourceEntriesFromDir,
    type SourceEntry,
  } from "$lib/config/icon-source";
  import { listMetaDir } from "$lib/config/meta-files";
  import { brokerIconPath } from "$lib/config/icon-ops";
  import { copyIconFile, writeIconFile } from "$lib/config/icon-files";

  /** Pick one icon (single pick closes the browser) or many ("Add all"). The
   *  values are already in stored form; keywords/name are suggestions. */
  let {
    onPick,
    onClose,
  }: {
    onPick: (value: string, meta: { keywords: string[]; name: string }) => void;
    onClose: () => void;
  } = $props();

  type Resource = "library" | "mdi" | "objects" | "adapter";

  const RESOURCES: { id: Resource; label: string; hint: string }[] = [
    { id: "library", label: "Library", hint: "Icons already curated" },
    { id: "mdi", label: "MDI", hint: "The bundled Material Design icons" },
    { id: "objects", label: "ioBroker", hint: "Icons broker objects carry" },
    {
      id: "adapter",
      label: "Adapter folders",
      hint: "Icons shipped by adapters",
    },
  ];

  type MdiIcon = {
    id: string;
    p: string;
    c: string;
    n?: Record<string, string>;
  };
  type MdiCategory = { id: string; name?: Record<string, string> };

  /** The last folder/resource this browser browsed, so reopening the importer
   *  resumes curation instead of the first adapter. */
  const saved = readIconSourcePrefs();

  let resource = $state<Resource>(saved.resource);
  let search = $state("");
  let limit = $state(200);

  // Adapter folders
  let basePath = $state(saved.basePath);
  /** Copy the picked file instead of referencing the adapter path. Default on:
   *  a reference dies with the next update of the source adapter. */
  let downloadCopy = $state(saved.downloadCopy);
  let uploadError = $state("");
  let folder = $state(saved.folder);
  let entries = $state<SourceEntry[]>([]);
  let loading = $state(false);
  let error = $state("");

  /** Reopening resumes the last source. A stored folder from another base
   *  falls back to that base's root, so the tree always matches the Source
   *  field. */
  function startFolder(): string {
    const base = normalizeBase();
    return folder.startsWith(base) ? folder : base;
  }

  $effect(() => {
    writeIconSourcePrefs({ resource, basePath, folder, downloadCopy });
  });

  onMount(() => {
    if (resource === "adapter") {
      void loadIconAdapters();
      void loadMetaSpaces();
      void loadFolder(startFolder());
    } else if (resource === "mdi") {
      void loadMdi();
    }
  });

  // MDI
  let mdiIcons = $state.raw<MdiIcon[]>([]);
  let mdiCategories = $state.raw<MdiCategory[]>([]);
  let mdiCategory = $state("");
  let mdiTouched = $state(false);
  let mdiState = $state<"idle" | "loading" | "ready" | "error">("idle");
  let mdiError = $state("");

  // ioBroker objects
  let objectAdapter = $state("");
  let objectTouched = $state(false);

  $effect(() => {
    if (mdiTouched || mdiCategory) return;
    if (mdiState === "ready" && mdiCategoryCounts.length) {
      mdiCategory = mdiCategoryCounts[0].id;
    }
  });

  $effect(() => {
    if (objectTouched || objectAdapter) return;
    if (objectAdapters.length) objectAdapter = objectAdapters[0].name;
  });

  // Adapter and meta objects are not in the state cache; both are fetched once
  // through the object view instead.
  let metaSpaces = $state<string[]>([]);
  let metaStarted = false;
  let iconAdapters = $state<string[]>([]);
  let adaptersStarted = false;

  async function loadIconAdapters(): Promise<void> {
    if (adaptersStarted) return;
    adaptersStarted = true;
    try {
      const result = (await ioBroker.emitAsync(
        "getObjectView",
        "system",
        "adapter",
        { startkey: "", endkey: "香" },
      )) as { rows?: { id?: string }[] };
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      // The view can carry instance rows (`iqontrol.0`): the source is the
      // adapter, so the instance suffix is dropped.
      iconAdapters = [
        ...new Set(
          rows
            .map((row) =>
              (row.id ?? "")
                .replace(/^system\.adapter\./, "")
                .replace(/\.\d+$/, ""),
            )
            .filter(Boolean),
        ),
      ];
    } catch {
      adaptersStarted = false;
    }
  }

  async function loadMetaSpaces(): Promise<void> {
    if (metaStarted) return;
    metaStarted = true;
    try {
      const result = (await ioBroker.emitAsync(
        "getObjectView",
        "system",
        "meta",
        { startkey: "", endkey: "\u9999" },
      )) as { rows?: { id?: string; value?: unknown }[] };
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      metaSpaces = rows
        .map((row) => row.id ?? "")
        .filter((id) => /\.meta$/.test(id))
        .sort();
    } catch {
      metaStarted = false;
    }
  }

  /** Adapter file roots: every installed icon adapter plus every `*.meta`
   *  user-file space. */
  const sourceChoices = $derived(iconSourceChoices(iconAdapters, metaSpaces));

  const library = $derived(getIconPool().library);
  const libraryShown = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return library.filter(
      (icon) =>
        !query ||
        (icon.name ?? icon.value).toLowerCase().includes(query) ||
        icon.keywords.some((word) => word.includes(query)),
    );
  });

  const objectIcons = $derived.by(() => {
    const seen: Record<string, true> = {};
    const list: { id: string; value: string; adapter: string }[] = [];
    for (const [id, object] of (ioBroker.objects as Map<string, unknown>) ??
      []) {
      const value = (object as { common?: { icon?: unknown } } | null)?.common
        ?.icon;
      if (typeof value !== "string" || !value.trim() || seen[value]) {
        continue;
      }
      seen[value] = true;
      list.push({ id, value, adapter: id.split(".")[0] });
    }
    return list;
  });

  const objectAdapters = $derived.by(() => {
    const groups: Record<
      string,
      { id: string; value: string; adapter: string }[]
    > = {};
    for (const entry of objectIcons) {
      (groups[entry.adapter] ??= []).push(entry);
    }
    return Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, list]) => ({ name, list }));
  });

  const mdiName = (id: string): string =>
    mdiCategories.find((category) => category.id === id)?.name?.en ?? id;

  const mdiCategoryCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const icon of mdiIcons) {
      counts[icon.c] = (counts[icon.c] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }));
  });

  const mdiShown = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const base = mdiCategory
      ? mdiIcons.filter((icon) => icon.c === mdiCategory)
      : mdiIcons;
    if (!query) return base;
    return base.filter((icon) =>
      `${icon.id} ${icon.n?.en ?? ""} ${mdiName(icon.c)}`
        .toLowerCase()
        .includes(query),
    );
  });

  const objectShown = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const base = objectAdapter
      ? (objectAdapters.find((entry) => entry.name === objectAdapter)?.list ??
        [])
      : objectIcons;
    if (!query) return base;
    return base.filter(
      (entry) =>
        entry.id.toLowerCase().includes(query) ||
        entry.adapter.toLowerCase().includes(query),
    );
  });

  const iconEntries = $derived(entries.filter((e) => e.kind === "icon"));
  const folderEntries = $derived(entries.filter((e) => e.kind === "folder"));
  const visibleEntries = $derived(
    [...folderEntries, ...iconEntries].filter(
      (entry) =>
        !search.trim() ||
        entry.label.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const adapterIconCount = $derived(
    visibleEntries.filter((entry) => entry.kind === "icon").length,
  );
  const visibleIcons = $derived(
    visibleEntries.filter((entry) => entry.kind === "icon").slice(0, limit),
  );
  const shownCount = $derived(
    resource === "library"
      ? libraryShown.length
      : resource === "mdi"
        ? mdiShown.length
        : resource === "objects"
          ? objectShown.length
          : adapterIconCount,
  );

  function normalizeBase(): string {
    return `/${basePath.trim().replace(/^\/+/, "").replace(/\/*$/, "")}/`;
  }

  /** The folder through the file API: `/icons-x/sub/` is namespace `icons-x`,
   *  folder `sub`. Null when the namespace is not a readable file tree. */
  async function fileEntries(pathname: string): Promise<SourceEntry[] | null> {
    const [adapter, ...rest] = String(pathname ?? "")
      .replace(/^\/+|\/+$/g, "")
      .split("/");
    if (!adapter) return null;
    try {
      const rows = await listMetaDir(adapter, rest.join("/"));
      return sourceEntriesFromDir(
        pathname,
        rows.map((row) => ({ file: row.name, isDir: row.isDir })),
      );
    } catch {
      return null;
    }
  }

  async function loadFolder(pathname: string): Promise<void> {
    loading = true;
    error = "";
    try {
      const listed = await fileEntries(pathname);
      if (listed) {
        entries = listed;
      } else {
        // A namespace the file API cannot read (or a picker page): the web
        // adapter's own HTML listing still works.
        const url = new URL(pathname, document.baseURI);
        const response = await fetch(url, { headers: { Accept: "text/html" } });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        entries = parseListing(await response.text(), url.href);
      }
      folder = pathname;
      limit = 200;
      search = "";
    } catch (e) {
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadMdi(): Promise<void> {
    if (mdiState === "loading" || mdiState === "ready") return;
    mdiState = "loading";
    mdiError = "";
    try {
      const url = new URL("icon-library.js", document.baseURI).href;
      const module = (await import(/* @vite-ignore */ url)) as {
        ICON_LIBRARY: MdiIcon[];
        ICON_LIBRARY_CATEGORIES: MdiCategory[];
      };
      if (
        !Array.isArray(module.ICON_LIBRARY) ||
        !Array.isArray(module.ICON_LIBRARY_CATEGORIES)
      ) {
        throw new Error("icon-library.js has an unexpected shape");
      }
      mdiIcons = module.ICON_LIBRARY;
      mdiCategories = module.ICON_LIBRARY_CATEGORIES;
      mdiState = "ready";
    } catch (e) {
      mdiState = "error";
      mdiError = e instanceof Error ? e.message : String(e);
    }
  }

  function activate(resourceId: Resource | null): void {
    if (!resourceId) return;
    select(resourceId);
  }

  function select(resourceId: Resource): void {
    resource = resourceId;
    search = "";
    error = "";
    limit = 200;
    if (resourceId === "adapter") {
      void loadIconAdapters();
      void loadMetaSpaces();
      void loadFolder(startFolder());
    }
    if (resourceId === "mdi") void loadMdi();
  }

  function pickLibrary(icon: LibraryIcon, close = true): void {
    onPick(icon.value, {
      keywords: icon.keywords,
      name: icon.name ?? icon.value,
    });
    if (close) onClose();
  }

  function pickMdi(icon: MdiIcon, close = true): void {
    const name = icon.n?.en ?? icon.id;
    onPick(mdiIconValue(icon.p), {
      keywords: [
        ...new Set([...keywordWords(name), ...keywordWords(mdiName(icon.c))]),
      ],
      name,
    });
    if (close) onClose();
  }

  function pickObject(entry: { id: string; value: string }): void {
    onPick(brokerIconPath(entry.value, entry.id), {
      keywords: keywordWords(entry.id),
      name: entry.id.split(".").pop() ?? entry.id,
    });
  }

  async function pickFile(entry: SourceEntry, close = true): Promise<void> {
    const reference = importValue(basePath, entry.path);
    const value =
      (downloadCopy ? await copyIconFile(reference, entry.label) : null) ??
      reference;
    onPick(value, {
      keywords: keywordsFromPath(basePath, entry.path),
      name: entry.label,
    });
    if (close) onClose();
  }

  /** A local image file, stored in the shared space and added as its path. */
  function onUpload(event: Event): void {
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
      .then((value) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        onPick(value, { keywords: keywordWords(name), name });
        onClose();
      })
      .catch(() => {
        uploadError = "The image could not be stored.";
      });
  }

  async function addAll(): Promise<void> {
    if (resource === "library") {
      for (const icon of libraryShown) pickLibrary(icon, false);
      onClose();
      return;
    }
    if (resource === "mdi") {
      for (const icon of mdiShown.slice(0, limit)) pickMdi(icon, false);
      onClose();
      return;
    }
    if (resource === "objects") {
      for (const entry of objectShown.slice(0, limit)) pickObject(entry);
      onClose();
      return;
    }
    for (const entry of visibleIcons) await pickFile(entry, false);
    onClose();
  }

  function crumbUp(): void {
    const parent = folder.replace(/[^/]+\/$/, "");
    if (parent && parent !== folder) void loadFolder(parent);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label="Add icons">
  <div class="modal-content importer">
    <div class="modal-head">
      <h3>Add icons / images</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <OptionTabs
      bind:value={resource}
      label="Icon sources"
      tabs={RESOURCES}
      collapsible={false}
      showHint={false}
      onchange={activate}
    />

    <div class="importer-body">
      <section class="source">
        <div class="source-head">
          <input type="search" placeholder="Search…" bind:value={search} />
          {#if resource === "adapter"}
            <div class="base-line">
              <span class="label-mono">Known source</span>
              <select
                aria-label="Known icon sources"
                onchange={(e) => {
                  basePath = e.currentTarget.value;
                  void loadFolder(normalizeBase());
                }}
              >
                {#if !sourceChoices.some((s) => s.path === normalizeBase())}
                  <option value={basePath} selected
                    >Custom: {basePath.trim() || "—"}</option
                  >
                {/if}
                {#each sourceChoices as source (source.path)}
                  <option
                    value={source.path}
                    selected={normalizeBase() === source.path}
                    >{source.label}</option
                  >
                {/each}
              </select>
            </div>
            <div class="base-line">
              <span class="label-mono">Source</span>
              <input
                type="text"
                aria-label="Icon source base path"
                bind:value={basePath}
                onchange={() => void loadFolder(normalizeBase())}
              />
            </div>
            <label class="check copy-check">
              <input type="checkbox" bind:checked={downloadCopy} />
              <span>Save a copy (survives adapter updates)</span>
            </label>
          {/if}
          {#if resource === "objects"}
            <select
              aria-label="ioBroker adapter"
              bind:value={objectAdapter}
              onchange={() => (objectTouched = true)}
            >
              {#each objectAdapters as adapter (adapter.name)}
                <option value={adapter.name}
                  >{adapter.name} ({adapter.list.length})</option
                >
              {/each}
              <option value="">-- all --</option>
            </select>
          {/if}
          {#if resource === "mdi"}
            <select
              aria-label="MDI category"
              bind:value={mdiCategory}
              disabled={mdiState !== "ready"}
              onchange={() => (mdiTouched = true)}
            >
              {#each mdiCategoryCounts as category (category.id)}
                <option value={category.id}
                  >{mdiName(category.id)} ({category.count})</option
                >
              {/each}
              <option value="">-- all --</option>
            </select>
          {/if}
        </div>

        {#if resource === "adapter"}
          <div class="path-line">
            <button
              type="button"
              class="btn btn-sm btn-outline"
              title="Parent folder"
              onclick={crumbUp}>..</button
            >
            <code class="path">{folder}</code>
          </div>
        {/if}

        <div class="results">
          {#if resource === "library"}
            {#if libraryShown.length === 0}
              <p class="empty text-muted">No icons in the library yet.</p>
            {:else}
              <div class="grid">
                {#each libraryShown.slice(0, limit) as icon (icon.id)}
                  <button
                    type="button"
                    class="cell"
                    title={icon.name ?? icon.value}
                    aria-label={icon.name ?? icon.value}
                    onclick={() => pickLibrary(icon)}
                  >
                    <Icon value={icon.value} size={22} />
                  </button>
                {/each}
              </div>
            {/if}
          {:else if resource === "mdi"}
            {#if mdiState === "loading"}
              <p class="empty text-muted">Loading MDI icons…</p>
            {:else if mdiState === "error"}
              <p class="empty text-danger">{mdiError}</p>
            {:else}
              <div class="grid">
                {#each mdiShown.slice(0, limit) as icon (icon.id)}
                  <button
                    type="button"
                    class="cell"
                    title={icon.n?.en ?? icon.id}
                    aria-label={icon.n?.en ?? icon.id}
                    onclick={() => pickMdi(icon)}
                  >
                    <Icon value={mdiIconValue(icon.p)} size={22} />
                  </button>
                {/each}
              </div>
            {/if}
          {:else if resource === "objects"}
            {#if objectAdapters.length === 0}
              <p class="empty text-muted">
                No broker objects carry a common.icon.
              </p>
            {:else if objectShown.length === 0}
              <p class="empty text-muted">No icons match the search.</p>
            {:else}
              <div class="grid">
                {#each objectShown.slice(0, limit) as entry (entry.id)}
                  <button
                    type="button"
                    class="cell"
                    title={entry.id}
                    aria-label={entry.id}
                    onclick={() => {
                      pickObject(entry);
                      onClose();
                    }}
                  >
                    <Icon value={entry.value} owner={entry.id} size={22} />
                  </button>
                {/each}
              </div>
            {/if}
          {:else if resource === "adapter"}
            {#if loading}
              <p class="empty text-muted">Loading {folder}…</p>
            {:else if error}
              <p class="empty text-danger">
                Could not list {folder}: {error}. Set a base path that lists its
                files.
              </p>
            {:else if visibleEntries.length === 0}
              <p class="empty text-muted">Nothing in this folder.</p>
            {:else}
              <ul class="folders">
                {#each visibleEntries.filter((e) => e.kind === "folder") as entry (entry.path)}
                  <li>
                    <button
                      type="button"
                      class="folder"
                      onclick={() => void loadFolder(entry.path)}
                    >
                      <span class="material-symbols-outlined">folder</span>
                      <span class="folder-name">{entry.label}</span>
                    </button>
                  </li>
                {/each}
              </ul>
              <div class="grid">
                {#each visibleIcons as entry (entry.path)}
                  <button
                    type="button"
                    class="cell"
                    title={entry.label}
                    aria-label={entry.label}
                    onclick={() => void pickFile(entry)}
                  >
                    <Icon value={importValue(basePath, entry.path)} size={22} />
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        <div class="upload-line">
          <label class="upload">
            <input type="file" accept="image/*,.svg" onchange={onUpload} />
            <span class="btn btn-outline btn-sm">Upload image…</span>
          </label>
          {#if uploadError}
            <span class="text-danger hint">{uploadError}</span>
          {/if}
        </div>

        <div class="source-foot">
          <span class="text-muted hint">
            {#if resource === "adapter"}
              {shownCount} icons, {folderEntries.length} folders
            {:else}
              {shownCount} icons
            {/if}
          </span>
          {#if shownCount > 0}
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => void addAll()}
            >
              Add all shown
            </button>
          {/if}
          {#if shownCount > limit}
            <button
              type="button"
              class="btn btn-sm"
              onclick={() => (limit += 200)}>Load more</button
            >
          {/if}
        </div>
      </section>
    </div>
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
    width: min(860px, 100%);
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

  .importer-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }

  .source {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .source-head {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .path-line,
  .base-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .base-line input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 14rem;
    max-height: 50vh;
  }

  .folders {
    list-style: none;
    margin: 0 0 0.35rem;
    padding: 0;
  }

  .folder {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.2rem 0.35rem;
    border: 0;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    text-align: left;
  }

  .folder:hover {
    background-color: var(--surface-container);
  }

  .folder-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .source-foot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .hint {
    flex: 1 1 auto;
    font-size: var(--body-sm);
  }

  .upload-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .upload input {
    display: none;
  }

  .upload {
    cursor: pointer;
  }
</style>
