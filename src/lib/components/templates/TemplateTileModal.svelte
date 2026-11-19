<script lang="ts">
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { untrack } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { localizeName } from "$lib/config/format";
  import {
    autoFillRoles,
    boundFills,
    templateBindingRows,
  } from "$lib/config/slot-create";
  import { matchingOverride } from "$lib/config/source-overrides";
  import { autoFillTemplate } from "$lib/config/template-suggest";
  import {
    resolveTemplateReference,
    type TemplateReference,
  } from "$lib/config/template-reference";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { getOverrideRegistry } from "$lib/stores/overrides.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import type { Template } from "$lib/types/display";
  import type { LogicDef } from "$logic/types";

  /** Bind a tile template's roles to states: the main role first, the rest
   *  auto-filled from the same device/parent when the match is clear. Unbound
   *  roles are left out; applying creates the missing overrides. */
  let {
    template,
    logics = [],
    onCreate,
    onClose,
  }: {
    template: Template;
    logics?: LogicDef[];
    onCreate: (
      fills: Map<string, TemplateReference>,
      main: TemplateReference,
    ) => void;
    onClose: () => void;
  } = $props();

  const rows = $derived(templateBindingRows(template));
  const primary = $derived(rows.find((row) => row.primary) ?? rows[0]);
  const roleBased = $derived(!!template.roles?.length);

  let picking = $state<string | null>(untrack(() => primary?.key ?? null));
  const manualFills = new SvelteMap<string, TemplateReference>();
  const fills = new SvelteMap<string, TemplateReference>();
  /** Roles the user removed; a later auto-fill must not bring them back. */
  const cleared = new SvelteSet<string>();
  let error = $state("");

  const sourceName = (ref: TemplateReference): string =>
    localizeName(ref.object?.common?.name) || ref.ref;

  function pick(key: string, stateId: string, overrideId?: string): void {
    const resolved = resolveTemplateReference(
      stateId,
      ioBroker.objects as Map<string, any>,
      getVariables(),
    );
    if ("problem" in resolved) {
      picking = null;
      error = resolved.problem;
      return;
    }
    error = "";
    cleared.delete(key);
    const overrides = getOverrideRegistry().overrides;
    const override = overrideId
      ? overrides.find((entry) => entry.id === overrideId)
      : undefined;
    const row = rows.find((entry) => entry.key === key);
    // Existing override wins: a raw pick still binds the state's matching
    // repair instead of silently dropping it.
    const existing =
      !override && row?.repair
        ? matchingOverride(
            overrides,
            resolved.reference.stateId,
            { name: row.repair.name, role: row.repair.role },
            getVariables(),
          )
        : undefined;
    const reference: TemplateReference = {
      ...resolved.reference,
      ...(override
        ? { overrideId: override.id, overrideName: override.name }
        : existing
          ? { overrideId: existing.id, overrideName: existing.name }
          : {}),
    };
    manualFills.set(key, reference);
    picking = null;
    if (key === primary?.key) {
      if (roleBased) {
        fills.clear();
        for (const [name, fill] of autoFillRoles(
          template,
          reference,
          ioBroker.objects as Map<string, any>,
          key,
          overrides,
        )) {
          fills.set(name, fill);
        }
        for (const [name, fill] of manualFills) fills.set(name, fill);
      } else {
        const auto = autoFillTemplate(
          template,
          reference,
          ioBroker.objects as Map<string, any>,
          key,
        );
        fills.clear();
        for (const [name, fill] of boundFills(auto.fills, manualFills)) {
          fills.set(name, fill);
        }
      }
      for (const name of cleared) fills.delete(name);
    } else {
      fills.set(key, reference);
    }
  }

  /** Drop a bound role (auto-filled or chosen); Create drops its slot. */
  function clear(key: string): void {
    cleared.add(key);
    fills.delete(key);
    manualFills.delete(key);
  }

  function create(): void {
    const main = primary ? fills.get(primary.key) : undefined;
    if (!main) return;
    onCreate(fills, main);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !picking) onClose();
  }}
/>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Add a tile from a template"
>
  <div class="modal-card card">
    <div class="modal-head">
      <h3>Add tile from {template.name}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <p class="hint text-muted">
      {#if roleBased}
        Pick the main role's state first; the others fill from the same device
        or parent when the role, unit or name is clear. Missing overrides are
        created on the picked states. Unset roles are not added to the tile.
      {:else}
        Pick the main feature's state first; the others fill from the same
        device or parent when the match is clear. Unset features are not added
        to the tile.
      {/if}
    </p>
    {#if error}
      <p class="text-danger hint">{error}</p>
    {/if}

    <ul class="features">
      {#each rows as row (row.key)}
        {@const bound = fills.get(row.key)}
        {@const main = row.key === primary?.key}
        <li class="feature-row">
          <span class="feature-name">
            {row.label}
            {#if main}<span class="main-badge">main</span>{/if}
          </span>
          <span class="source" title={bound?.stateId ?? ""}>
            {bound
              ? `${sourceName(bound)}${bound.overrideName ? ` · ${bound.overrideName}` : ""}`
              : "not set"}
          </span>
          {#if bound}
            <IconButton
              icon="delete"
              danger
              label={`Clear the ${row.label} assignment`}
              onclick={() => clear(row.key)}
            />
          {/if}
          <button
            type="button"
            class="icon-btn"
            title={`Choose the ${row.label} state`}
            aria-label={`Choose the ${row.label} state`}
            onclick={() => (picking = row.key)}
          >
            <span class="material-symbols-outlined">edit</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!primary || !fills.get(primary.key)}
        onclick={create}>Create tile</button
      >
    </div>
  </div>
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title={`Choose ${rows.find((row) => row.key === picking)?.label ?? "the source"}`}
    {logics}
    logicPick="state"
    currentState={picking ? (fills.get(picking)?.stateId ?? "") : ""}
    onState={(stateId, overrideId) => pick(picking!, stateId, overrideId)}
    onClose={() => (picking = null)}
  />
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.45);
  }

  .modal-card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(560px, 100%);
    max-height: 85vh;
    overflow: auto;
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    padding: 1rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .modal-head h3 {
    margin: 0;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .features {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .feature-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }

  .feature-name {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex: 0 0 auto;
  }

  .main-badge {
    padding: 0 4px;
    border-radius: var(--border-radius-pill);
    background: var(--primary-container);
    color: var(--on-primary-container);
    font-size: 10px;
    text-transform: uppercase;
  }

  .source {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--body-sm);
    text-align: right;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
</style>
