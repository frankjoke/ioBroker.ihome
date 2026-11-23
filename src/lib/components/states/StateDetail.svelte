<script lang="ts">
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import SourceOverrideModal from "$lib/components/overrides/SourceOverrideModal.svelte";
  import CustomSettings from "./CustomSettings.svelte";
  import HistoryData from "./HistoryData.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue } from "$lib/config/format";
  import {
    commitOverrides,
    getOverrideRegistry,
  } from "$lib/stores/overrides.svelte";
  import {
    overridesForState,
    removeOverride as removeOverrideEntry,
    upsertOverride,
  } from "$lib/config/source-overrides";
  import { deleteTitle } from "$lib/utils/delete-title";
  import type { SourceOverride } from "$lib/types/overrides";
  import type { GlobalVariable } from "$lib/config/variables";

  let {
    id,
    object,
    variables,
  }: {
    id: string;
    object: any;
    variables: GlobalVariable[];
  } = $props();

  const TABS = [
    { id: "state", label: "State", hint: "The broker object and live value." },
    {
      id: "override",
      label: "Override",
      hint: "Repairs and derived values for this state.",
    },
    {
      id: "custom",
      label: "Custom",
      hint: "common.custom entries, including history configuration.",
    },
    {
      id: "history",
      label: "History",
      hint: "Stored data through the history adapter.",
    },
  ] as const;
  let tab = $state<"state" | "override" | "custom" | "history">("state");
  let overrideForm = $state<{ override?: SourceOverride } | null>(null);
  let pendingDelete = $state<SourceOverride | null>(null);
  let message = $state("");

  const overrides = $derived(
    overridesForState(getOverrideRegistry(), id, variables),
  );
  const common = $derived((object?.common ?? {}) as Record<string, any>);
  const live = $derived(
    (ioBroker.states as unknown as Map<string, any>)?.get?.(id),
  );

  function customSaved(): void {
    message = "Custom settings saved.";
  }

  async function saveOverride(next: SourceOverride): Promise<void> {
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      upsertOverride(registry, next),
      registry.updatedAt,
    );
    if (result === "saved") {
      overrideForm = null;
      message = "Override saved.";
    } else {
      message =
        result === "conflict"
          ? "The override list changed in another tab; reload and try again."
          : "The override could not be saved.";
    }
  }

  async function deleteOverride(idToRemove: string): Promise<void> {
    const registry = getOverrideRegistry();
    const result = await commitOverrides(
      removeOverrideEntry(registry, idToRemove),
      registry.updatedAt,
    );
    pendingDelete = null;
    message =
      result === "saved"
        ? "Override removed."
        : result === "conflict"
          ? "The override list changed in another tab; reload and try again."
          : "The override could not be removed.";
  }
</script>

<div class="detail-body">
  <div class="title-row">
    <div>
      <h2>{String(common.name ?? id)}</h2>
      <p class="mono text-muted">{id}</p>
    </div>
    <span class="badge">{common.type || "state"}</span>
  </div>

  <OptionTabs
    bind:value={tab}
    label="State sections"
    tabs={TABS}
    collapsible={false}
  >
    {#snippet children(active)}
      {#if active === "state"}
        <dl class="summary">
          <dt>Name</dt>
          <dd>{String(common.name ?? "")}</dd>
          <dt>Role</dt>
          <dd class="mono">{String(common.role ?? "")}</dd>
          <dt>Unit</dt>
          <dd>{String(common.unit ?? "")}</dd>
          <dt>Read / write</dt>
          <dd>
            {common.read === false ? "read-only" : "read"} / {common.write ===
            true
              ? "writable"
              : "read-only"}
          </dd>
          <dt>Value</dt>
          <dd class="mono">
            {formatValue(live?.val, common.unit, common.role)}
            {#if live?.from}<span class="text-muted"> · {live.from}</span>{/if}
          </dd>
        </dl>
      {:else if active === "override"}
        <div class="section-head">
          <p class="hint text-muted">
            Repairs change how this state is displayed; derived values are
            computed from its group. One state may have several.
          </p>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick={() => (overrideForm = {})}>Add override</button
          >
        </div>
        {#if overrides.length === 0}
          <p class="hint text-muted">No override on this state.</p>
        {:else}
          <ul class="rows">
            {#each overrides as override (override.id)}
              <li class="item-line">
                <span class="badge">{override.kind}</span>
                <span class="name">{override.name}</span>
                <span class="mono hint text-muted">
                  {override.role ?? override.type ?? ""}
                </span>
                <span class="item-actions">
                  <button
                    type="button"
                    class="btn btn-sm"
                    onclick={() => (overrideForm = { override })}>Edit</button
                  >
                  <button
                    type="button"
                    class="btn btn-sm"
                    onclick={() => (pendingDelete = override)}>Delete</button
                  >
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if active === "custom"}
        {#key id}
          <CustomSettings stateId={id} {object} onchanged={customSaved} />
        {/key}
      {:else}
        {#key id}
          <HistoryData
            stateId={id}
            customKeys={Object.keys(common.custom ?? {}).sort()}
          />
        {/key}
      {/if}
    {/snippet}
  </OptionTabs>

  {#if message}<p class="hint text-muted">{message}</p>{/if}
</div>

{#if overrideForm}
  <SourceOverrideModal
    stateId={id}
    {object}
    override={overrideForm.override}
    existingNames={overrides.map((override) => override.name)}
    onSave={saveOverride}
    onDelete={(overrideId) => {
      const found = overrides.find((override) => override.id === overrideId);
      if (found) pendingDelete = found;
    }}
    onClose={() => (overrideForm = null)}
  />
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("override", pendingDelete.name)}
    confirmLabel="Delete"
    onConfirm={() => void deleteOverride(pendingDelete!.id)}
    onCancel={() => (pendingDelete = null)}
  >
    <p class="text-muted">
      This removes the override from <span class="mono">{id}</span>. The state
      itself stays.
    </p>
  </ConfirmModal>
{/if}

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

  .summary {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.3rem 0.8rem;
    margin: 0;
  }

  .summary dt {
    color: var(--text-muted);
    font-size: var(--body-sm);
  }

  .summary dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
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

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .item-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
  }

  .item-line .name {
    font-weight: 500;
  }

  .item-actions {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
</style>
