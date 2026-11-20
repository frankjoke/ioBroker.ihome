<script lang="ts">
  import { slugify, uniqueSlug } from "$lib/config/slug";
  import {
    applyPartLabel,
    bundleApplyParts,
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
  import {
    commitLogics,
    getLogicDocument,
    isLogicsWritable,
    logicBlocked,
  } from "$lib/stores/logics.svelte";
  import { getTemplateBundles } from "$lib/stores/template-bundles.svelte";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { validateDeviceTemplate } from "$logic/device-templates";
  import { validateLogicDocument } from "$logic/validate";
  import type { TemplateBundle } from "$lib/types/templates";
  import type { DeviceTemplateShape, LogicTemplate } from "$logic/types";
  import HelpSection from "./HelpSection.svelte";
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
  const needsLogic = $derived(!!(bundle.api || bundle.logic));
  const writable = $derived(!needsLogic || isLogicsWritable());
  const blocked = $derived(needsLogic ? logicBlocked() : false);
  // svelte-ignore state_referenced_locally
  let values = $state(logicApplyDefaults(bundle.params ?? []));
  // svelte-ignore state_referenced_locally
  let baseState = $state(
    `${ioBroker.namespace}.Variables.${slugify(bundle.name) || "device"}`,
  );
  let apiShape = $state<DeviceTemplateShape | null>(null);
  let apiProblem = $state("");
  let preflightProblem = $state<string | null>(null);
  let error = $state("");
  let applying = $state(false);

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
      <HelpSection help={bundle.help} />
      <TemplateParamForm params={bundle.params ?? []} bind:values />
      {#if bundle.api}
        <label class="field">
          <span class="label-mono">Base state</span>
          <input type="text" bind:value={baseState} aria-label="Base state" />
          <span class="hint text-muted"
            >Folder for the API-created states; must start with {ioBroker.namespace}.</span
          >
        </label>
      {/if}
      {#if preflightProblem}
        <p class="text-danger hint">{preflightProblem}</p>
      {/if}
      {#if apiProblem}
        <p class="text-danger hint">API: {apiProblem}</p>
      {/if}
      {#if !writable}
        <p class="text-danger hint">
          The logic document could not be loaded — applying is disabled.
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
