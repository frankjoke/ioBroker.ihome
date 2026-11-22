<script lang="ts">
  import { suggestTemplatesForState } from "$lib/config/template-suggest";
  import { templateBindingRows } from "$lib/config/slot-create";
  import type { Template } from "$lib/types/display";

  let {
    state,
    templates,
    onPick,
    onBlank,
    onClose,
  }: {
    state: { stateId: string; object: any };
    templates: Template[];
    /** The template and the role (or feature) the state fills in it. */
    onPick: (template: Template, key: string) => void;
    onBlank: () => void;
    onClose: () => void;
  } = $props();

  const suggestions = $derived(suggestTemplatesForState(state, templates));
  const stateName = $derived(
    String(state.object?.common?.name ?? state.stateId),
  );
  const role = $derived(String(state.object?.common?.role ?? ""));
  const bindingCount = (template: Template): number =>
    template.roles?.length ?? templateBindingRows(template).length;
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Fits this state">
  <div class="modal-card card">
    <h3>Fits this state</h3>
    <div class="body">
      <p class="hint text-muted">
        <strong>{stateName}</strong>
        <span class="mono">{state.stateId}</span>
        {#if role}<span class="badge">{role}</span>{/if}
      </p>
      <p class="hint text-muted">
        A template may also bind related states from the same device. To show
        only this state, choose “Just this state”.
      </p>
      {#if suggestions.length === 0}
        <p class="hint text-muted">No template matches this state.</p>
      {:else}
        <div class="suggestions">
          {#each suggestions as suggestion (suggestion.template.id)}
            {@const count = bindingCount(suggestion.template)}
            <button
              type="button"
              class="suggestion"
              onclick={() => onPick(suggestion.template, suggestion.key)}
            >
              <span class="suggestion-name">{suggestion.template.name}</span>
              <span class="badge">{suggestion.template.type}</span>
              {#if count > 1}
                <span class="badge" title="States this template can bind"
                  >{count} states</span
                >
              {/if}
              <span class="hint text-muted">{suggestion.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={onBlank}>
        Just this state
      </button>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(34rem, 100%);
    padding: 1rem;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0.8rem 0;
  }

  .body .hint {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .suggestion {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
    background: var(--surface-color);
    color: var(--text-color);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .suggestion:hover {
    border-color: var(--primary-color);
    background: var(--row-hover);
  }

  .suggestion-name {
    font-weight: 600;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
