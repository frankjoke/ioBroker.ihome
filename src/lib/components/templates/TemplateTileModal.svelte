<script lang="ts">
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { localizeName } from "$lib/config/format";
  import { primaryFeature } from "$lib/config/template-ops";
  import { boundFills, templateBindingRows } from "$lib/config/slot-create";
  import { autoFillTemplate } from "$lib/config/template-suggest";
  import {
    resolveTemplateReference,
    type TemplateReference,
  } from "$lib/config/template-reference";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import type { Template } from "$lib/types/display";
  import type { LogicDef } from "$logic/types";

  /** Bind a tile template's features to states: the main feature first, the
   *  rest auto-filled from the same device/parent when the match is clear.
   *  Unbound features are left out of the created tile. */
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
  const primary = $derived(primaryFeature(rows) ?? rows[0]);

  let picking = $state<string | null>(untrack(() => primary?.feature ?? null));
  const manualFills = new SvelteMap<string, TemplateReference>();
  const fills = new SvelteMap<string, TemplateReference>();
  let error = $state("");

  const sourceName = (ref: TemplateReference): string =>
    localizeName(ref.object?.common?.name) || ref.ref;

  function pick(feature: string, stateId: string): void {
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
    manualFills.set(feature, resolved.reference);
    picking = null;
    if (feature === primary?.feature) {
      const auto = autoFillTemplate(
        template,
        resolved.reference,
        ioBroker.objects as Map<string, any>,
        feature,
      );
      fills.clear();
      for (const [name, ref] of boundFills(auto.fills, manualFills)) {
        fills.set(name, ref);
      }
    } else {
      fills.set(feature, resolved.reference);
    }
  }

  function create(): void {
    const main = primary ? fills.get(primary.feature) : undefined;
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
      Pick the main feature's state first; the others fill from the same device
      or parent when the match is clear. Unset features are not added to the
      tile.
    </p>
    {#if error}
      <p class="text-danger hint">{error}</p>
    {/if}

    <ul class="features">
      {#each rows as feature (feature.feature)}
        {@const bound = fills.get(feature.feature)}
        {@const main = feature.feature === primary?.feature}
        <li class="feature-row">
          <span class="feature-name">
            {feature.label}
            {#if main}<span class="main-badge">main</span>{/if}
          </span>
          <span class="source" title={bound?.stateId ?? ""}>
            {bound ? sourceName(bound) : "not set"}
          </span>
          <button
            type="button"
            class="icon-btn"
            title={`Choose the ${feature.label} state`}
            aria-label={`Choose the ${feature.label} state`}
            onclick={() => (picking = feature.feature)}
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
        disabled={!primary || !fills.get(primary.feature)}
        onclick={create}>Create tile</button
      >
    </div>
  </div>
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title={`Choose ${rows.find((feature) => feature.feature === picking)?.label ?? "the source"}`}
    {logics}
    logicPick="state"
    currentState={picking ? (fills.get(picking)?.stateId ?? "") : ""}
    onState={(stateId) => pick(picking!, stateId)}
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
