<script lang="ts">
  import {
    devicesForTemplate,
    planDeviceApply,
  } from "$lib/config/template-apply";
  import { getCanonicalRegistry } from "$lib/stores/devices.svelte";
  import { upsertDevice } from "$lib/registry.svelte.js";
  import HelpSection from "./HelpSection.svelte";
  import type { Template } from "$lib/types/display";

  let {
    template,
    onClose,
  }: {
    template: Template;
    onClose: () => void;
  } = $props();

  const devices = $derived(getCanonicalRegistry().devices ?? []);
  const targets = $derived(devicesForTemplate(template, devices));
  let targetId = $state("");
  let error = $state("");

  $effect(() => {
    if (!targets.some((device) => device.id === targetId)) {
      targetId = targets[0]?.id ?? "";
    }
  });

  function apply() {
    error = "";
    const target = targets.find((device) => device.id === targetId);
    const plan = planDeviceApply(template, target);
    if ("problem" in plan) {
      error = plan.problem;
      return;
    }
    upsertDevice(plan.device);
    onClose();
  }
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Apply template">
  <div class="modal-card card">
    <h3>Apply device template</h3>
    <div class="body">
      <p class="hint text-muted">
        Apply <strong>{template.name}</strong> to a
        <strong>{template.type}</strong> device.
      </p>
      <HelpSection help={template.help} />
      {#if targets.length > 0}
        <label class="field">
          <span class="label-mono">Target device</span>
          <select bind:value={targetId} aria-label="Target device">
            {#each targets as device (device.id)}
              <option value={device.id}>{device.name}</option>
            {/each}
          </select>
          <span class="hint text-muted"
            >The device keeps its controls and states; only the visual template
            changes.</span
          >
        </label>
      {:else}
        <p class="hint text-muted">
          No {template.type} devices yet — add one under Devices first.
        </p>
      {/if}
      {#if error}
        <p class="text-danger hint">{error}</p>
      {/if}
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={targets.length === 0}
        onclick={apply}
      >
        Apply
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
    width: min(32rem, 100%);
    padding: 1rem;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0.8rem 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
