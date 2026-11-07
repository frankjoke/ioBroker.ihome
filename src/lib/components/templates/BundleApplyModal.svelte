<script lang="ts">
  import { slugify, uniqueSlug } from "$lib/config/slug";
  import {
    applyPartLabel,
    bundleApplyParts,
    bundleDeviceTemplate,
    bundleLogicParams,
    logicApplyDefaults,
    planLogicApply,
    resolveTemplateParams,
    runApplyParts,
  } from "$lib/config/template-apply";
  import {
    bundleApiSource,
    evaluateBundleApi,
    templateBundleProblem,
  } from "$lib/config/template-bundles";
  import { stateIdFor, validStateId } from "$lib/config/variables";
  import {
    createTemplateStates,
    planDeviceTemplate,
  } from "$lib/device-template-apply";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { upsertDevice } from "$lib/registry.svelte.js";
  import { getCanonicalRegistry } from "$lib/stores/devices.svelte";
  import {
    commitLogics,
    getLogicDocument,
    isLogicsWritable,
    logicBlocked,
  } from "$lib/stores/logics.svelte";
  import {
    commitTemplates,
    getTemplateRegistry,
    isTemplatesWritable,
  } from "$lib/stores/templates.svelte.js";
  import { getTemplateBundles } from "$lib/stores/template-bundles.svelte";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { newId } from "$lib/utils/ids";
  import { validateDeviceTemplate } from "$logic/device-templates";
  import { validateLogicDocument } from "$logic/validate";
  import type { Device } from "$lib/types/device";
  import type { TemplateBundle } from "$lib/types/templates";
  import type { DeviceTemplateShape, LogicTemplate } from "$logic/types";
  import TemplateParamForm from "./TemplateParamForm.svelte";

  let {
    bundle,
    onClose,
  }: {
    bundle: TemplateBundle;
    onClose: () => void;
  } = $props();

  const parts = $derived(bundleApplyParts(bundle));
  const doc = $derived(getLogicDocument());
  const registry = $derived(getTemplateRegistry());
  const needsLogic = $derived(!!(bundle.api || bundle.logic));
  const needsTemplates = $derived(!!bundle.device);
  const writable = $derived(
    (!needsLogic || isLogicsWritable()) &&
      (!needsTemplates || isTemplatesWritable()),
  );
  const blocked = $derived(needsLogic ? logicBlocked() : false);
  // svelte-ignore state_referenced_locally
  let values = $state(logicApplyDefaults(bundle.params ?? []));
  // svelte-ignore state_referenced_locally
  let baseState = $state(
    `${ioBroker.namespace}.Variables.${slugify(bundle.name) || "device"}`,
  );
  let deviceName = $state("");
  let targetId = $state("");
  let apiShape = $state<DeviceTemplateShape | null>(null);
  let apiProblem = $state("");
  let preflightProblem = $state<string | null>(null);
  let error = $state("");
  let applying = $state(false);

  const targetCandidates = $derived.by(() => {
    const part = bundle.device;
    if (!part) return [];
    return (getCanonicalRegistry().devices ?? [])
      .filter((device) => device.type === part.type)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  $effect(() => {
    // Keep a chosen device valid when the list changes, but leave the empty
    // “use the API-created device / none” option selectable.
    if (
      targetId &&
      !targetCandidates.some((device) => device.id === targetId)
    ) {
      targetId = "";
    }
  });

  let loadedBundleId = "";
  $effect(() => {
    if (loadedBundleId === bundle.id) return;
    loadedBundleId = bundle.id;
    const bundleIds = getTemplateBundles().map((entry) => entry.id);
    const logicIds = doc.logics.map((logic) => logic.id);
    preflightProblem = templateBundleProblem(
      bundle,
      bundleIds,
      logicIds,
      bundle.id,
      { validateApi: false },
    );
    if (!bundle.api) {
      apiShape = null;
      apiProblem = "";
      return;
    }
    try {
      const value = evaluateBundleApi(bundle);
      const check = validateDeviceTemplate(value);
      if (check.errors.length > 0) {
        apiShape = null;
        apiProblem = check.errors[0];
      } else {
        apiShape = check.template ?? null;
        apiProblem = "";
      }
    } catch (e) {
      apiShape = null;
      apiProblem = e instanceof Error ? e.message : String(e);
    }
  });

  async function apply() {
    error = "";
    if (applying) return;
    if (!writable) {
      error = "The logic or template document could not be loaded.";
      return;
    }
    if (blocked) {
      error = "The logic document has errors — fix them before applying.";
      return;
    }
    const preflight = templateBundleProblem(
      bundle,
      getTemplateBundles().map((entry) => entry.id),
      doc.logics.map((logic) => logic.id),
      bundle.id,
      { validateApi: false },
    );
    if (preflight) {
      error = preflight;
      return;
    }
    if (bundle.api && !apiShape) {
      error = apiProblem || "The API part is not valid.";
      return;
    }
    const resolved = resolveTemplateParams(bundle.params ?? [], values, (ref) =>
      stateIdFor(ref, getVariables()),
    );
    if ("problem" in resolved) {
      error = resolved.problem;
      return;
    }

    applying = true;
    let logicDoc = doc;
    let apiDevice: Device | undefined;
    const failure = await runApplyParts(parts, async (part) => {
      if (part === "api") {
        if (!bundle.api || !apiShape) {
          throw new Error("The API part is not valid.");
        }
        if (!validStateId(baseState)) {
          throw new Error("Base state needs adapter.instance.path.");
        }
        const suffix = baseState.split(".").pop() ?? "device";
        const id = uniqueSlug(
          slugify(`${bundle.id}-${suffix}`) || bundle.id,
          logicDoc.logics.map((logic) => logic.id),
        );
        const plan = planDeviceTemplate(
          apiShape,
          bundleApiSource(bundle, apiShape),
          resolved.values,
          baseState,
          id,
          bundle.name,
          deviceName,
        );
        await createTemplateStates(plan.specs, baseState);
        const nextDoc = {
          ...logicDoc,
          logics: [...logicDoc.logics, plan.logic],
        };
        const issues = validateLogicDocument(nextDoc).filter(
          (issue) => issue.severity === "error",
        );
        if (issues.length > 0) {
          throw new Error(`${issues[0].path}: ${issues[0].message}`);
        }
        if (!commitLogics(nextDoc)) {
          throw new Error("The logic document could not be saved.");
        }
        logicDoc = nextDoc;
        if (plan.device) {
          upsertDevice(plan.device);
          apiDevice = plan.device;
        }
        return;
      }

      if (part === "device") {
        const devicePart = bundle.device;
        if (!devicePart) throw new Error("The bundle has no device part.");
        const target =
          apiDevice && apiDevice.type === devicePart.type
            ? apiDevice
            : (getCanonicalRegistry().devices ?? []).find(
                (device) => device.id === targetId,
              );
        if (!target) {
          throw new Error("Choose a target device for the device part.");
        }
        if (target.type !== devicePart.type) {
          throw new Error(
            `The device part is for ${devicePart.type} devices, but ${target.name} is a ${target.type} device.`,
          );
        }
        const template = bundleDeviceTemplate(
          $state.snapshot(devicePart),
          newId(),
          bundle.name,
        );
        const nextRegistry = {
          ...registry,
          templates: [...(registry.templates ?? []), template],
        };
        if (!commitTemplates(nextRegistry)) {
          throw new Error("The device template document could not be saved.");
        }
        upsertDevice({ ...target, template: template.id });
        return;
      }

      if (!bundle.logic) throw new Error("The bundle has no logic part.");
      const logicTemplate: LogicTemplate = {
        id: bundle.id,
        name: bundle.name,
        params: bundleLogicParams(bundle),
        logic: bundle.logic.logic,
      };
      const plan = planLogicApply(
        logicTemplate,
        resolved.values,
        logicDoc.logics.map((logic) => logic.id),
        logicDoc.logics,
      );
      if ("problem" in plan) throw new Error(plan.problem);
      const nextDoc = { ...logicDoc, logics: [...logicDoc.logics, plan.logic] };
      if (!commitLogics(nextDoc)) {
        throw new Error("The logic document could not be saved.");
      }
      logicDoc = nextDoc;
    });
    applying = false;
    if (failure) {
      error = `${applyPartLabel(failure.part)}: ${failure.error}`;
      return;
    }
    onClose();
  }
</script>

<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Apply template bundle"
>
  <div class="modal-card card">
    <h3>Apply bundle</h3>
    <div class="body">
      <p class="hint text-muted">
        Apply <strong>{bundle.name}</strong> in order
        {#each parts as part, index (part)}
          {#if index > 0}→{/if}
          {applyPartLabel(part)}
        {/each}.
      </p>
      <TemplateParamForm params={bundle.params ?? []} bind:values />
      {#if bundle.api}
        <label class="field">
          <span class="label-mono">Base state</span>
          <input type="text" bind:value={baseState} aria-label="Base state" />
          <span class="hint text-muted"
            >Folder for the API-created states; must start with {ioBroker.namespace}.</span
          >
        </label>
        <label class="field">
          <span class="label-mono">Device name (optional)</span>
          <input
            type="text"
            bind:value={deviceName}
            aria-label="Device name"
            placeholder="Creates a device from the API states"
          />
          <span class="hint text-muted"
            >Creates the device with the API-created controls. Leave empty to
            create only the states and machine.</span
          >
        </label>
      {/if}
      {#if bundle.device}
        <label class="field">
          <span class="label-mono">Target device</span>
          <select bind:value={targetId} aria-label="Target device">
            <option value="">— use the API-created device / none —</option>
            {#each targetCandidates as device (device.id)}
              <option value={device.id}>{device.name}</option>
            {/each}
          </select>
        </label>
        <p class="hint text-muted">
          Used for the Device part when the API part does not create a matching
          device.
        </p>
      {/if}
      {#if preflightProblem}
        <p class="text-danger hint">{preflightProblem}</p>
      {/if}
      {#if apiProblem}
        <p class="text-danger hint">API: {apiProblem}</p>
      {/if}
      {#if !writable}
        <p class="text-danger hint">
          The logic or template document could not be loaded — applying is
          disabled.
        </p>
      {:else if blocked}
        <p class="text-danger hint">
          The logic document has errors — fix them before applying.
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
        disabled={applying ||
          !!preflightProblem ||
          !!apiProblem ||
          !writable ||
          blocked}
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
    width: min(38rem, 100%);
    max-height: 88vh;
    overflow: auto;
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
