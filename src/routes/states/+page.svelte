<script lang="ts">
  import { onMount, tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { page } from "$app/state";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import {
    getOverrideRegistry,
    initOverrides,
  } from "$lib/stores/overrides.svelte";
  import { patchView, readView } from "$lib/stores/page-view";
  import { takeRequestedStateConfig } from "$lib/pages.js";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ContextMenu from "$lib/components/common/ContextMenu.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import StateList from "$lib/components/states/StateList.svelte";
  import StateDetail from "$lib/components/states/StateDetail.svelte";
  import StateCreateModal from "$lib/components/states/StateCreateModal.svelte";
  import VariablesPanel from "$lib/components/variables/VariablesPanel.svelte";
  import {
    isIhomeConfigState,
    isSystemInstance,
    keptInstance,
    restoreSelection,
    stateEntries,
    stateMatches,
    stateRoles,
    type StateEntry,
    type StateFilters,
  } from "$lib/config/state-settings";
  import { enumShortId, functionList, roomList } from "$lib/config/rooms";
  import {
    STATES_TABS,
    resolveStatesTab,
    type StatesTab,
  } from "$lib/config/states-tabs";
  import { STATES_GUIDE, VARIABLES_GUIDE } from "$lib/config/page-guides";
  import { copyText } from "$lib/utils/clipboard";
  import { ownerOf } from "$lib/utils/icon-url";
  import { toast } from "$lib/stores/toasts.svelte";

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const variables = $derived(getVariables());
  const saved = readView("/states");

  /** The app is hash-routed; the tab query lives inside the hash. */
  function hashQuery(): URLSearchParams {
    const hash = page.url.hash;
    return new URLSearchParams(
      hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "",
    );
  }

  const requestedTab =
    page.url.searchParams.get("tab") ?? hashQuery().get("tab");
  const initialTab = resolveStatesTab(requestedTab, saved?.tab);
  let tab = $state<StatesTab>(initialTab);
  let tabValue = $state<StatesTab | null>(initialTab);
  const restoreId = takeRequestedStateConfig() || saved?.openId || "";
  let restored = false;
  let query = $state(saved?.query ?? "");
  const savedFilters = saved?.filters ?? {};
  let filters = $state<StateFilters>({
    override: savedFilters.override === true,
    history: savedFilters.history === true,
    role: typeof savedFilters.role === "string" ? savedFilters.role : "",
    room: typeof savedFilters.room === "string" ? savedFilters.room : "",
    function:
      typeof savedFilters.function === "string" ? savedFilters.function : "",
  });
  let instance = $state(saved?.instance ?? "");
  let selectedId = $state("");
  let creating = $state(false);
  let sortDir = $state<"asc" | "desc">("asc");
  let variablesOpen = $state(false);
  let variablesPanel = $state<{
    startAdd: (kind: "state" | "constant") => void;
  } | null>(null);
  let detailRef = $state<{
    addHistory: () => void | Promise<void>;
    addOverride: () => void;
    requestDelete: () => void;
  } | null>(null);
  let stateMenu = $state<{
    x: number;
    y: number;
    entry: StateEntry;
  } | null>(null);
  let pendingAction = $state<{
    id: string;
    action: "history" | "override" | "delete";
  } | null>(null);

  const entries = $derived(
    stateEntries(
      objects,
      getOverrideRegistry().overrides,
      variables,
      ioBroker.enums,
    ).filter(
      (entry) =>
        !isSystemInstance(entry.instance) && !isIhomeConfigState(entry.id),
    ),
  );
  const instances = $derived(
    [...new Set(entries.map((entry) => entry.instance))].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  const shown = $derived(
    entries.filter((entry) =>
      stateMatches(entry, query, { ...filters, instance }),
    ),
  );
  const selected = $derived(objects.get(selectedId));

  const roleOptions = $derived([
    { value: "", label: "All roles" },
    ...stateRoles(objects, filters.role ?? "").map((role) => ({
      value: role,
      label: role,
    })),
  ]);
  const roomOptions = $derived(
    withCurrent(
      [
        { value: "", label: "All rooms" },
        ...roomList(ioBroker.enums).map((room) => ({
          value: room.id,
          label: room.label,
        })),
      ],
      filters.room ?? "",
      "Room",
    ),
  );
  const functionOptions = $derived(
    withCurrent(
      [
        { value: "", label: "All functions" },
        ...functionList(ioBroker.enums).map((fn) => ({
          value: fn.id,
          label: fn.label,
        })),
      ],
      filters.function ?? "",
      "Function",
    ),
  );

  function withCurrent(
    options: { value: string; label: string }[],
    value: string,
    label: string,
  ) {
    if (value && !options.some((option) => option.value === value)) {
      options.push({ value, label: `${label} ${enumShortId(value)}` });
    }
    return options;
  }

  function changeTab(next: StatesTab | null): void {
    const target = next ?? "states";
    tab = target;
    tabValue = target;
    patchView("/states", { tab: target });
    history.replaceState(history.state, "", `#/states?tab=${target}`);
  }

  function select(id: string): void {
    selectedId = id;
    patchView("/states", { openId: id });
  }

  function openState(id: string): void {
    changeTab("states");
    select(id);
  }

  function deletedState(id: string): void {
    const next = shown.find((entry) => entry.id !== id);
    selectedId = next?.id ?? "";
    patchView("/states", { openId: next?.id ?? null });
  }

  function openStateMenu(entry: StateEntry, event: MouseEvent): void {
    stateMenu = { x: event.clientX, y: event.clientY, entry };
  }

  async function copyStateField(value: string, label: string): Promise<void> {
    if (await copyText(value)) {
      toast.success(`Copied ${label}`, { key: "state-copy" });
    } else {
      toast.error(`Could not copy the ${label}`);
    }
  }

  function runStateAction(
    entry: StateEntry,
    action: "history" | "override" | "delete",
  ): void {
    changeTab("states");
    select(entry.id);
    pendingAction = { id: entry.id, action };
  }

  $effect(() => {
    const pending = pendingAction;
    if (!pending || selectedId !== pending.id || !detailRef) return;
    pendingAction = null;
    void tick().then(() => {
      if (selectedId !== pending.id) return;
      if (pending.action === "history") void detailRef?.addHistory();
      else if (pending.action === "override") detailRef?.addOverride();
      else detailRef?.requestDelete();
    });
  });

  function setInstance(value: string): void {
    instance = value;
    const next = entries.filter((entry) =>
      stateMatches(entry, query, { ...filters, instance: value }),
    );
    if (next.length && !next.some((entry) => entry.id === selectedId)) {
      select(next[0].id);
    }
  }

  function created(id: string): void {
    creating = false;
    instance = "";
    query = "";
    filters = {};
    select(id);
    void ioBroker.getObject(id, true).catch(() => undefined);
  }

  // A view remembered in the previous run can name an instance that is gone;
  // the select would show --all-- while the filter still hid every state.
  $effect(() => {
    const next = keptInstance(instance, instances);
    if (next !== instance) instance = next;
  });

  $effect(() => {
    if (restored || entries.length === 0) return;
    restored = true;
    const id = restoreSelection(entries, restoreId);
    if (id) select(id);
  });

  // A remembered tab (or a programmatic change) must also appear in the URL,
  // so a refresh and a copied link keep the same tab.
  $effect(() => {
    if (hashQuery().get("tab") === tab) return;
    history.replaceState(history.state, "", `#/states?tab=${tab}`);
  });

  // The object cache starts with states; fetch a row's meta/device/folder
  // ancestors and adapter instance only when the row is actually in view.
  // Walking every state up front floods the socket on a full broker.
  const iconRequests = new SvelteSet<string>();
  const iconQueue: string[] = [];
  let pumpingIcons = false;
  let iconObserver: IntersectionObserver | null = null;
  let rowsObserver: MutationObserver | null = null;

  function watchRowIcons(root: HTMLElement): void {
    root
      .querySelectorAll<HTMLElement>(".state-row[data-state-id]")
      .forEach((row) => iconObserver?.observe(row));
  }

  function queueRowAncestors(stateId: string): void {
    const ids: string[] = [];
    let cur = stateId;
    while (cur) {
      ids.push(cur);
      const cut = cur.lastIndexOf(".");
      if (cut < 0) break;
      cur = cur.slice(0, cut);
    }
    const { adapter, instance: ownerInstance } = ownerOf(stateId);
    if (adapter) {
      if (ownerInstance) {
        ids.push(`system.adapter.${adapter}.${ownerInstance}`);
      }
      ids.push(`system.adapter.${adapter}`);
    }
    for (const id of ids) {
      if (ioBroker.objects.has(id) || iconRequests.has(id)) continue;
      iconRequests.add(id);
      iconQueue.push(id);
    }
    void pumpRowIcons();
  }

  async function pumpRowIcons(): Promise<void> {
    if (pumpingIcons) return;
    pumpingIcons = true;
    try {
      while (iconQueue.length) {
        const batch = iconQueue.splice(0, 8);
        await Promise.allSettled(
          batch.map((id) =>
            ioBroker.getObject(id, true).catch(() => undefined),
          ),
        );
      }
    } finally {
      pumpingIcons = false;
    }
  }

  $effect(() => {
    patchView("/states", {
      query,
      instance,
      filters: {
        override: filters.override === true,
        history: filters.history === true,
        role: filters.role ?? "",
        room: filters.room ?? "",
        function: filters.function ?? "",
      },
    });
  });

  onMount(() => {
    void initOverrides().catch(() => undefined);
    iconObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.stateId;
          if (id) queueRowAncestors(id);
        }
      },
      { rootMargin: "200px 0px" },
    );
    const rows = document.querySelector<HTMLElement>(".state-list .rows");
    if (rows) {
      watchRowIcons(rows);
      rowsObserver = new MutationObserver(() => {
        iconObserver?.disconnect();
        watchRowIcons(rows);
      });
      rowsObserver.observe(rows, { childList: true });
    }
    return () => {
      iconObserver?.disconnect();
      rowsObserver?.disconnect();
    };
  });
</script>

<svelte:head>
  <title>States - iHome</title>
</svelte:head>

<div class="states-page">
  <div class="item">
    <div class="item-line title-line">
      <div class="tabs-line">
        <OptionTabs
          bind:value={tabValue}
          label="States, variables and constants"
          tabs={STATES_TABS}
          collapsible={false}
          showHint={false}
          onchange={changeTab}
        />
      </div>
      <div class="page-actions">
        {#if tab === "states"}
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            onclick={() => (creating = true)}
          >
            + State
          </button>
        {:else if tab === "variables"}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            title="Sort by name"
            aria-label={`Sort by name ${sortDir === "asc" ? "descending" : "ascending"}`}
            onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
          >
            Sort {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            disabled={variablesOpen}
            onclick={() => variablesPanel?.startAdd("state")}
          >
            + Variable
          </button>
        {:else if tab === "constants"}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            title="Sort by name"
            aria-label={`Sort by name ${sortDir === "asc" ? "descending" : "ascending"}`}
            onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
          >
            Sort {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm add-action"
            disabled={variablesOpen}
            onclick={() => variablesPanel?.startAdd("constant")}
          >
            + Constant
          </button>
        {/if}
      </div>
    </div>
    {#if tab === "help"}
      <div class="item-editor">
        <HelpSection help={STATES_GUIDE} static plain />
        <HelpSection help={VARIABLES_GUIDE} static plain />
      </div>
    {/if}
  </div>

  <div class="tab-panel states" hidden={tab !== "states"}>
    <div class="states-grid">
      <StateList
        entries={shown}
        {selectedId}
        {instances}
        {instance}
        {query}
        {filters}
        {roleOptions}
        {roomOptions}
        {functionOptions}
        onselect={select}
        oninstance={setInstance}
        onquery={(value) => (query = value)}
        onfilters={(value) => (filters = value)}
        oncontext={openStateMenu}
      />

      <section class="detail card">
        {#if selected}
          <StateDetail
            bind:this={detailRef}
            id={selectedId}
            object={selected}
            {variables}
            ondelete={deletedState}
          />
        {:else}
          <p class="hint text-muted">Select a state on the left.</p>
        {/if}
      </section>
    </div>
  </div>

  <div class="tab-panel" hidden={tab !== "variables" && tab !== "constants"}>
    <VariablesPanel
      bind:this={variablesPanel}
      bind:hasOpenEditor={variablesOpen}
      kind={tab === "constants" ? "constant" : "state"}
      {sortDir}
      onopenstate={openState}
    />
  </div>
</div>

{#if creating}
  <StateCreateModal oncreated={created} onclose={() => (creating = false)} />
{/if}

{#if stateMenu}
  {@const menu = stateMenu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    heading={menu.entry.id}
    label="State"
    items={[
      {
        id: "copy-id",
        label: "Copy state ID",
        icon: "content_copy",
        run: () => {
          void copyStateField(menu.entry.id, "state ID");
        },
      },
      {
        id: "copy-name",
        label: "Copy state name",
        icon: "label",
        run: () => {
          void copyStateField(menu.entry.name, "state name");
        },
      },
      {
        id: "history",
        label: "Add history",
        icon: "history",
        run: () => runStateAction(menu.entry, "history"),
      },
      {
        id: "override",
        label: "Add override",
        icon: "tune",
        run: () => runStateAction(menu.entry, "override"),
      },
      {
        id: "delete",
        label: "Delete state",
        icon: "delete",
        danger: true,
        run: () => runStateAction(menu.entry, "delete"),
      },
    ]}
    onclose={() => (stateMenu = null)}
  />
{/if}

<style>
  .states-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 1200px;
    margin: 0 auto;
    height: calc(100vh - 4.5rem);
    height: calc(100dvh - 4.5rem);
    min-height: 0;
  }

  .tab-panel {
    min-height: 0;
  }

  .tab-panel[hidden] {
    display: none !important;
  }

  .tab-panel.states {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .tab-panel:not(.states):not([hidden]) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .states-page > .item .item-editor {
    max-height: calc(100dvh - 12rem);
    overflow-y: auto;
  }

  .title-line {
    cursor: default;
  }

  .tabs-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .page-actions .add-action {
    min-width: 7rem;
    justify-content: center;
  }

  .states-grid {
    display: grid;
    grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: stretch;
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
  }

  .detail {
    padding: 1rem;
    min-height: 0;
    min-width: 0;
    max-height: 100%;
    overflow-y: auto;
  }

  @media (max-width: 820px) {
    .states-grid {
      display: flex;
      flex-direction: column;
      height: auto;
    }

    .tab-panel.states {
      overflow-y: auto;
    }

    .detail {
      max-height: none;
      overflow: visible;
    }
  }
</style>
