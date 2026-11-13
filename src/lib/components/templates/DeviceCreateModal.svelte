<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import HelpSection from "./HelpSection.svelte";
  import {
    referenceFromSource,
    resolveTemplateReference,
    type TemplateReference,
  } from "$lib/config/template-reference";
  import {
    autoFillTemplate,
    type FeatureCandidate,
  } from "$lib/config/template-suggest";
  import { planDeviceCreate } from "$lib/config/device-template-create";
  import { primaryFeature, templateFeatures } from "$lib/config/template-ops";
  import { roomsOf } from "$lib/config/rooms";
  import { isRegistryWritable, upsertDevice } from "$lib/registry.svelte.js";
  import { getCanonicalRegistry } from "$lib/stores/devices.svelte";
  import { getLogicDocument } from "$lib/stores/logics.svelte";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { newId } from "$lib/utils/ids";
  import type { SlotSource } from "$lib/types/display";
  import type { Template } from "$lib/types/display";
  import type { Device } from "$lib/types/device";

  let {
    template,
    initial = null,
    onClose,
    onCreated,
  }: {
    template: Template;
    initial?: { reference: TemplateReference; feature?: string } | null;
    onClose: () => void;
    onCreated?: (device: Device) => void;
  } = $props();

  const features = $derived(templateFeatures(template));
  const primary = $derived(primaryFeature(features));
  const objects = $derived(ioBroker.objects as Map<string, any>);
  const devices = $derived(getCanonicalRegistry().devices ?? []);
  const variables = $derived(getVariables());
  const templates = $derived(getTemplateRegistry().templates ?? []);
  const logics = $derived(getLogicDocument().logics);
  const deviceWritable = $derived(isRegistryWritable());

  let main = $state<TemplateReference | null>(null);
  let anchor = $state("");
  let fills = $state<FeatureCandidate[]>([]);
  let name = $state("");
  let room = $state("");
  let icon = $state("");
  let error = $state("");
  let picking = $state(false);
  let pickingFor = $state<string | null>(null);
  let started = false;

  const missing = $derived(
    features.filter(
      (feature) =>
        feature.required &&
        !fills.some(
          (fill) =>
            fill.feature.feature === feature.feature &&
            fill.stateId !== undefined,
        ),
    ),
  );
  const canCreate = $derived(
    deviceWritable &&
      !!name.trim() &&
      missing.length === 0 &&
      fills.some((fill) => fill.stateId),
  );

  function applyMain(reference: TemplateReference, featureKey: string): void {
    main = reference;
    fills = autoFillTemplate(template, reference, objects, featureKey).fills;
    if (!name) name = String(reference.object?.common?.name ?? template.name);
    if (!room)
      room = roomsOf(ioBroker.enums as any, reference.stateId)[0] ?? "";
  }

  $effect(() => {
    if (started) return;
    started = true;
    anchor = initial?.feature ?? primary?.feature ?? "";
    if (initial) applyMain(initial.reference, anchor);
  });

  function openPicker(feature: string): void {
    pickingFor = feature;
    picking = true;
    error = "";
  }

  function onSource(source: SlotSource): void {
    const ref = referenceFromSource(source, devices);
    if (!ref) {
      error = "Pick a state or a device control.";
      return;
    }
    const resolved = resolveTemplateReference(ref, objects, variables);
    if ("problem" in resolved) {
      error = resolved.problem;
      return;
    }
    const reference = resolved.reference;
    const target = pickingFor;
    picking = false;
    pickingFor = null;
    error = "";
    if (target === "__main__") {
      applyMain(reference, anchor || primary?.feature || "");
      return;
    }
    if (!target) return;
    fills = fills.map((fill) =>
      fill.feature.feature === target
        ? {
            ...fill,
            ref: reference.ref,
            stateId: reference.stateId,
            object: reference.object,
            candidates: [reference],
            ambiguous: false,
          }
        : fill,
    );
  }

  function clearFill(feature: string): void {
    fills = fills.map((fill) =>
      fill.feature.feature === feature
        ? {
            ...fill,
            ref: undefined,
            stateId: undefined,
            object: undefined,
            candidates: [],
            ambiguous: false,
            conflict: false,
          }
        : fill,
    );
  }

  function chooseCandidate(
    feature: FeatureCandidate,
    reference: TemplateReference,
  ): void {
    fills = fills.map((fill) =>
      fill.feature === feature.feature
        ? {
            ...fill,
            ref: reference.ref,
            stateId: reference.stateId,
            object: reference.object,
            candidates: [reference],
            ambiguous: false,
          }
        : fill,
    );
  }

  function create(): void {
    error = "";
    const chosen = fills.filter(
      (
        fill,
      ): fill is FeatureCandidate & {
        ref: string;
        stateId: string;
        object: any;
      } => !!fill.ref && !!fill.stateId && !!fill.object,
    );
    const plan = planDeviceCreate({
      template,
      name,
      room,
      icon,
      fills: chosen.map((fill) => ({
        feature: fill.feature.feature,
        ref: fill.ref,
        stateId: fill.stateId,
        object: fill.object,
      })),
      newId,
      newControlId: newId,
    });
    if ("problem" in plan) {
      error = plan.problem;
      return;
    }
    if (!upsertDevice(plan.device)) {
      error = "The device document is not readable — nothing was saved.";
      return;
    }
    onCreated?.(plan.device);
    onClose();
  }

  function stateName(object: any, stateId: string): string {
    return String(object?.common?.name ?? stateId);
  }

  function roleOf(object: any): string {
    return String(object?.common?.role ?? "");
  }
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Create device from template"
>
  <div class="modal-card card">
    <h3>Create {template.name}</h3>
    <HelpSection help={template.help} />
    <div class="body">
      <div class="main-state">
        <div>
          <span class="label-mono">Starting state</span>
          <p class="hint text-muted">
            {features.find(
              (feature) => feature.feature === (anchor || primary?.feature),
            )?.label ??
              primary?.label ??
              "State"}
          </p>
        </div>
        {#if main}
          <span class="state-chip">
            <span>{stateName(main.object, main.stateId)}</span>
            <span class="mono hint">{main.stateId}</span>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => openPicker("__main__")}>Change</button
            >
          </span>
        {:else}
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={() => openPicker("__main__")}
          >
            Choose state
          </button>
        {/if}
      </div>

      {#if main}
        <div class="fills">
          {#each fills as fill (fill.feature.feature)}
            <div
              class="fill"
              class:missing={fill.feature.required && !fill.stateId}
            >
              <div class="fill-name">
                <span>{fill.feature.label}</span>
                {#if fill.feature.required}
                  <span class="badge badge-secondary">required</span>
                {/if}
              </div>
              <div class="fill-value">
                {#if fill.stateId}
                  <span>{stateName(fill.object, fill.stateId)}</span>
                  <span class="mono hint">{fill.stateId}</span>
                  {#if roleOf(fill.object)}
                    <span class="badge">{roleOf(fill.object)}</span>
                  {/if}
                {:else if fill.candidates.length > 1}
                  <select
                    aria-label={`Choose ${fill.feature.label}`}
                    value=""
                    onchange={(event) => {
                      const choice =
                        fill.candidates[Number(event.currentTarget.value)];
                      if (choice) chooseCandidate(fill, choice);
                    }}
                  >
                    <option value="">Choose a state…</option>
                    {#each fill.candidates as candidate, index (candidate.stateId)}
                      <option value={index}>
                        {stateName(candidate.object, candidate.stateId)} — {roleOf(
                          candidate.object,
                        )}
                      </option>
                    {/each}
                  </select>
                {:else}
                  <span class="hint text-muted">
                    {fill.feature.required ? "Required" : "Not used"}
                  </span>
                {/if}
              </div>
              {#if fill.conflict}
                <span class="text-danger hint">
                  Also matched by another feature — choose one.
                </span>
              {/if}
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onclick={() => openPicker(fill.feature.feature)}
              >
                {fill.stateId ? "Change" : "Choose"}
              </button>
              {#if fill.stateId || fill.candidates.length > 0}
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() => clearFill(fill.feature.feature)}
                >
                  Clear
                </button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="fields">
          <label class="field">
            <span class="label-mono">Name</span>
            <input type="text" bind:value={name} aria-label="Device name" />
          </label>
          <label class="field">
            <span class="label-mono">Room</span>
            <input
              type="text"
              bind:value={room}
              placeholder="enum.rooms.…"
              aria-label="Room"
            />
          </label>
          <label class="field">
            <span class="label-mono">Icon</span>
            <input
              type="text"
              bind:value={icon}
              placeholder="optional glyph or URL"
              aria-label="Icon"
            />
          </label>
        </div>
      {/if}

      {#if missing.length > 0}
        <p class="text-danger hint">
          Fill the required controls: {missing
            .map((feature) => feature.label)
            .join(", ")}.
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
        disabled={!canCreate}
        onclick={create}
      >
        Create device
      </button>
    </div>
  </div>
</div>

{#if picking}
  <SourcePicker
    mode="source"
    title={pickingFor === "__main__"
      ? "Choose the starting state"
      : "Choose a state"}
    {devices}
    {templates}
    {logics}
    logicPick="state"
    {onSource}
    onClose={() => {
      picking = false;
      pickingFor = null;
    }}
  />
{/if}

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

  .modal-card {
    width: min(42rem, 100%);
    max-height: 88vh;
    overflow: auto;
    padding: 1rem;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0.8rem 0;
  }

  .main-state,
  .fill {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .main-state {
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--border-color);
  }

  .main-state .hint,
  .fill .hint {
    margin: 0;
  }

  .state-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .fills {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .fill {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .fill.missing {
    border-left: 3px solid var(--danger-color);
    padding-left: 0.5rem;
  }

  .fill-name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 8rem;
  }

  .fill-value {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 14rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .fill-value .mono {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .field input {
    width: 100%;
    box-sizing: border-box;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
