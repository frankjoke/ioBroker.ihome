<script lang="ts">
  import { untrack } from "svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import SourceOverrideModal from "$lib/components/overrides/SourceOverrideModal.svelte";
  import HistoryData from "./HistoryData.svelte";
  import StateGeneral from "./StateGeneral.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { localizeName } from "$lib/config/format";
  import {
    defaultHistoryAdapter,
    historyKeys as historyKeysOf,
    isHistoryCustom,
  } from "$lib/config/state-settings";
  import { writeStateCustom } from "$lib/config/state-write";
  import {
    commitOverrides,
    getOverrideRegistry,
  } from "$lib/stores/overrides.svelte";
  import {
    overridesForState,
    removeOverride as removeOverrideEntry,
    upsertOverride,
  } from "$lib/config/source-overrides";
  import type { SourceOverride } from "$lib/types/overrides";
  import type { GlobalVariable } from "$lib/config/variables";

  let {
    id,
    object,
    variables,
    ondelete,
  }: {
    id: string;
    object: any;
    variables: GlobalVariable[];
    ondelete?: (id: string) => void;
  } = $props();

  type Tab = "state" | "override" | "history";

  let tab = $state<Tab>("state");
  let openOverrideId = $state<string | null>(null);
  let openHistoryAdapter = $state("");
  let overrideAutoTried = false;
  let historyAutoTried = false;
  let message = $state("");
  let deleting = $state(false);
  let deleteBusy = $state(false);

  const overrides = $derived(
    overridesForState(getOverrideRegistry(), id, variables),
  );
  const common = $derived((object?.common ?? {}) as Record<string, any>);
  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const historyKeys = $derived(historyKeysOf(common.custom));
  const defaultHistory = $derived(defaultHistoryAdapter(objects));
  const hasOverrides = $derived(overrides.length > 0);
  const hasHistory = $derived(historyKeys.length > 0);
  const tabs = $derived([
    {
      id: "state" as const,
      label: "State",
      hint: "The broker object and live value.",
      disabled: false,
    },
    {
      id: "override" as const,
      label: "Override",
      hint: "UI-only repairs and derived values for this state.",
      disabled: !hasOverrides && !openOverrideId,
    },
    {
      id: "history" as const,
      label: "History",
      hint: "Stored data through the history adapter.",
      disabled: !hasHistory,
    },
  ]);
  const historyCandidates = $derived.by(() => {
    const out: string[] = [];
    if (defaultHistory) out.push(defaultHistory);
    for (const entry of objects.values()) {
      const custom = entry?.common?.custom;
      if (!custom || typeof custom !== "object") continue;
      for (const [key, value] of Object.entries(custom)) {
        if (key !== "ihome" && isHistoryCustom(value) && !out.includes(key)) {
          out.push(key);
        }
      }
    }
    const known = ["history", "influxdb", "sql", "timescaledb"];
    for (const objectId of objects.keys()) {
      const match = /^system\.adapter\.([^.]+)\.(\d+)\.alive$/.exec(objectId);
      if (!match || !known.includes(match[1])) continue;
      const key = `${match[1]}.${match[2]}`;
      if (!out.includes(key)) out.push(key);
    }
    return out;
  });
  const hasUnusedHistory = $derived(
    historyCandidates.some((key) => !historyKeys.includes(key)),
  );
  const historyInstalled = $derived(defaultHistory !== "");
  const live = $derived(
    (ioBroker.states as unknown as Map<string, any>)?.get?.(id),
  );

  let lastId = untrack(() => id);
  $effect(() => {
    if (id === lastId) return;
    lastId = id;
    openOverrideId = null;
    openHistoryAdapter = "";
    tab = "state";
  });
  $effect(() => {
    if (tab !== "override") {
      overrideAutoTried = false;
      return;
    }
    if (overrideAutoTried) return;
    if (!overrides.length) return;
    overrideAutoTried = true;
    if (!openOverrideId) openOverrideId = overrides[0].id;
  });
  $effect(() => {
    if (tab !== "history") {
      historyAutoTried = false;
      return;
    }
    if (historyAutoTried) return;
    if (!historyKeys.length) return;
    historyAutoTried = true;
    if (!openHistoryAdapter) openHistoryAdapter = historyKeys[0];
  });
  $effect(() => {
    if (tab === "override" && !hasOverrides && !openOverrideId) tab = "state";
    if (tab === "history" && !hasHistory) tab = "state";
  });

  export function addOverride(): void {
    openOverrideId = "new";
    tab = "override";
  }

  export function requestDelete(): void {
    deleting = true;
  }

  function onOverrideLineClick(event: MouseEvent, overrideId: string): void {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    openOverrideId = openOverrideId === overrideId ? null : overrideId;
  }

  export async function addHistory(): Promise<void> {
    if (!defaultHistory) {
      message = "No default history adapter is configured.";
      return;
    }
    const key = historyCandidates.find(
      (candidate) => !historyKeys.includes(candidate),
    );
    if (!key) {
      message = "No history adapter found.";
      return;
    }
    let template: Record<string, unknown> | undefined;
    for (const entry of objects.values()) {
      const value = entry?.common?.custom?.[key];
      if (isHistoryCustom(value)) {
        template = { ...(value as Record<string, unknown>) };
        break;
      }
    }
    const config = template
      ? { ...template, enabled: true, aliasId: "" }
      : {
          enabled: true,
          debounceTime: 0,
          blockTime: 0,
          changesOnly: false,
          aliasId: "",
        };
    try {
      await writeStateCustom(id, {
        ...(common.custom ?? {}),
        [key]: config,
      });
      await ioBroker.getObject(id, true).catch(() => undefined);
      message = `History adapter ${key} added.`;
      tab = "history";
    } catch (failure) {
      message = failure instanceof Error ? failure.message : String(failure);
    }
  }

  async function saveOverride(next: SourceOverride): Promise<void> {
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      upsertOverride(registry, next),
      registry.updatedAt,
    );
    if (result !== "saved") {
      throw new Error(
        result === "conflict"
          ? "The override list changed in another tab; reload and try again."
          : "The override could not be saved.",
      );
    }
    openOverrideId = next.id;
    message = "Override saved.";
  }

  /** Remove the broker object and its value; history and iHome references stay. */
  async function deleteState(): Promise<void> {
    if (deleteBusy) return;
    deleteBusy = true;
    message = "";
    try {
      await ioBroker.emitAsync("delObject", id);
      await ioBroker.emitAsync("delState", id).catch(() => undefined);
      ioBroker.objects.delete(id);
      ioBroker.states.delete(id);
      deleting = false;
      ondelete?.(id);
    } catch (error) {
      deleting = false;
      message = `Delete failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    } finally {
      deleteBusy = false;
    }
  }

  async function deleteOverride(idToRemove: string): Promise<void> {
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      removeOverrideEntry(registry, idToRemove),
      registry.updatedAt,
    );
    if (result !== "saved") {
      throw new Error(
        result === "conflict"
          ? "The override list changed in another tab; reload and try again."
          : "The override could not be removed.",
      );
    }
    openOverrideId = null;
    message = "Override removed.";
  }
</script>

<div class="detail-body">
  <div class="title-row">
    <div>
      <h2>{localizeName(common.name) || id}</h2>
      <p class="mono text-muted">{id}</p>
    </div>
    <span class="badge">{common.type || "state"}</span>
  </div>

  <OptionTabs
    bind:value={tab}
    label="State sections"
    {tabs}
    collapsible={false}
  >
    {#snippet actions()}
      {#if !hasOverrides}
        <button type="button" class="btn btn-sm" onclick={addOverride}
          >+ Override</button
        >
      {/if}
      {#if historyInstalled && hasUnusedHistory}
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => void addHistory()}>+ History</button
        >
      {/if}
      <IconButton
        icon="delete"
        danger
        label={`Delete state ${id}`}
        onclick={() => (deleting = true)}
      />
    {/snippet}
    {#snippet children(active)}
      {#if active === "state"}
        {#key id}
          <StateGeneral
            {id}
            {object}
            {live}
            onchanged={() => (message = "State settings saved.")}
          />
        {/key}
      {:else if active === "override"}
        <div class="section-head">
          <p class="hint text-muted">
            Repairs change how this state is displayed; derived values are
            computed from its group. Overrides are used by the iHome UI only —
            the logic engine never sees them; use the real state or a variable
            in logic. One state may have several overrides.
          </p>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick={addOverride}>+ Add override</button
          >
        </div>
        {#if overrides.length === 0 && openOverrideId !== "new"}
          <p class="hint text-muted">No override on this state.</p>
        {/if}
        <div class="items">
          {#each overrides as override (override.id)}
            <div class="item" class:open={openOverrideId === override.id}>
              <!-- The free line area is a mouse convenience; the name button is the keyboard control. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="item-line"
                onclick={(event) => onOverrideLineClick(event, override.id)}
              >
                <button
                  type="button"
                  class="name"
                  aria-expanded={openOverrideId === override.id}
                  onclick={() =>
                    (openOverrideId =
                      openOverrideId === override.id ? null : override.id)}
                >
                  {override.name}
                </button>
                <span class="badge">{override.kind}</span>
                <span class="mono hint text-muted">
                  {override.role ?? override.type ?? ""}
                </span>
                {#if override.history}
                  <span class="badge badge-secondary">history</span>
                {/if}
              </div>
              {#if openOverrideId === override.id}
                <div class="item-editor">
                  <SourceOverrideModal
                    inline
                    stateId={id}
                    {object}
                    {override}
                    existingNames={overrides.map((entry) => entry.name)}
                    historyAvailable={hasHistory}
                    onSave={saveOverride}
                    onDelete={deleteOverride}
                    onClose={() => (openOverrideId = null)}
                  />
                </div>
              {/if}
            </div>
          {/each}
          {#if openOverrideId === "new"}
            <div class="item open">
              <div class="item-line">
                <span class="name">New override</span>
              </div>
              <div class="item-editor">
                <SourceOverrideModal
                  inline
                  stateId={id}
                  {object}
                  existingNames={overrides.map((entry) => entry.name)}
                  historyAvailable={hasHistory}
                  onSave={saveOverride}
                  onDelete={deleteOverride}
                  onClose={() => (openOverrideId = null)}
                />
              </div>
            </div>
          {/if}
        </div>
      {:else}
        {#key id}
          <HistoryData
            stateId={id}
            customKeys={historyKeys}
            {object}
            defaultAdapter={defaultHistory}
            adapters={historyCandidates}
            bind:openAdapter={openHistoryAdapter}
          />
        {/key}
      {/if}
    {/snippet}
  </OptionTabs>

  {#if deleting}
    <ConfirmModal
      title={`Delete ${localizeName(common.name) || id}?`}
      confirmLabel={deleteBusy ? "Deleting…" : "Delete"}
      onConfirm={() => void deleteState()}
      onCancel={() => (deleting = false)}
    >
      <p>This removes the ioBroker state object and its current value.</p>
      {#if object?.native?.ihomeCollection?.plugin}
        <p class="hint text-danger">
          This state is managed by plugin {object.native.ihomeCollection
            .plugin}; a plugin update may recreate it.
        </p>
      {/if}
      <p class="hint text-muted">
        Stored history, iHome overrides and variables that reference this state
        are not removed.
      </p>
    </ConfirmModal>
  {/if}

  {#if message}<p class="hint text-muted">{message}</p>{/if}
</div>

<style>
  .detail-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title-row h2 {
    margin: 0;
    font-size: var(--headline-sm);
  }

  .title-row p {
    margin: 0.1rem 0 0;
  }

  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .section-head .hint {
    margin: 0;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
</style>
