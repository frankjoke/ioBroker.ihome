<script lang="ts">
  import type { DeviceType, Control } from "$lib/types/device";
  import { newId } from "$lib/utils/ids";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { suggestFeature, roleLabel } from "$lib/config/features";
  import { defaultUnit } from "$lib/config/units";
  import { sourceForControl } from "$lib/config/template-ops";
  import { SvelteSet } from "svelte/reactivity";
  import StateBrowser from "./StateBrowser.svelte";
  import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";

  let {
    deviceType,
    device,
    objects,
    roomsOf,
    rooms,
    enums = undefined,
    mode = "add",
    onAdd,
    onSource,
    onClose,
  }: {
    deviceType: DeviceType;
    /** In source mode: the device whose controls are offered above the tree. */
    device?: EnrichedDevice;
    objects: Map<string, any>;
    roomsOf: (id: string) => string[];
    rooms: { id: string; label: string; icon?: string }[];
    enums?: any;
    /** "replace" points an existing control at another state — one pick only.
     *  "source" returns one source string for a slot or active condition. */
    mode?: "add" | "replace" | "source";
    onAdd: (controls: Control[]) => void;
    onSource?: (source: string) => void;
    onClose: () => void;
  } = $props();

  const isSource = $derived(mode === "source");

  const selection = new SvelteSet<string>();

  const controls = $derived((device?.controls ?? []).filter((c) => !c.hidden));

  /** A source points at a feature while that is unambiguous on this device,
   *  else at the control's id — exactly what the slot pickers store (A36). */
  function pickControl(c: EnrichedControl) {
    onSource?.(sourceForControl(controls, c) || c.id);
  }

  function toggle(id: string) {
    if (mode === "source") {
      onSource?.(id);
      return;
    }
    if (mode === "replace") {
      selection.clear();
      selection.add(id);
    } else if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
  }

  function add() {
    if (isSource) return; // source mode picks on click
    const variables = getVariables().filter(
      (v) => v.kind === "state" && v.stateId,
    );
    const controls = [...selection].map((id): Control => {
      const variable = variables.find((v) => v.name === id);
      // A variable is named as the state it stands for; its real object (when
      // the cache has it) supplies role, unit and writability.
      const obj = variable
        ? (objects.get(String(variable.stateId)) ?? {
            common: {
              name: variable.name,
              type: variable.type,
              role: variable.role,
              unit: variable.unit,
              write: false,
            },
          })
        : objects.get(id);
      return {
        id: newId(),
        feature: suggestFeature(obj, deviceType) ?? "value",
        stateId: id,
        writable: !!obj?.common?.write,
        label: variable ? id : roleLabel(obj),
        unit: defaultUnit(obj),
      };
    });
    if (controls.length) onAdd(controls);
  }
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label={isSource
    ? "Choose a source"
    : mode === "replace"
      ? "Change state"
      : "Add states"}
>
  <div class="modal-content">
    <div class="modal-head">
      <h3>
        {isSource
          ? "Choose a source"
          : mode === "replace"
            ? "Change state"
            : "Add states"}
      </h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    {#if isSource && controls.length}
      <div class="device-sources">
        <span class="device-sources-label">This device</span>
        <div class="device-sources-list">
          {#each controls as c (c.id)}
            <button
              type="button"
              class="device-source"
              title={c.stateId ?? c.feature}
              onclick={() => pickControl(c)}
            >
              {c.label || c.feature || c.id}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <StateBrowser
      {objects}
      {roomsOf}
      {rooms}
      {enums}
      {selection}
      onToggle={toggle}
    />

    <div class="actions">
      {#if isSource}
        <span class="text-muted">Pick a control or a state</span>
        <div class="actions-buttons">
          <button type="button" class="btn" onclick={onClose}>Cancel</button>
        </div>
      {:else}
        <span class="text-muted">{selection.size} selected</span>
        <div class="actions-buttons">
          <button type="button" class="btn" onclick={onClose}>Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={selection.size === 0}
            onclick={add}
          >
            {#if mode === "replace"}
              Use state
            {:else}
              Add {selection.size || ""}
              {selection.size === 1 ? "control" : "controls"}
            {/if}
          </button>
        </div>
      {/if}
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
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(760px, 100%);
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

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .device-sources {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .device-sources-label {
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .device-sources-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-height: 7.5rem;
    overflow: auto;
  }

  .device-source {
    border: 1px solid var(--border-color);
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: 999px;
    padding: 0.25rem 0.65rem;
    cursor: pointer;
  }

  .device-source:hover {
    border-color: var(--accent-color, #1976d2);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .actions-buttons {
    display: flex;
    gap: 0.5rem;
  }
</style>
