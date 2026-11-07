import { BUILTIN_DEVICE_TEMPLATES } from "$lib/config/device-templates";
import { BUILTIN_FUNCTIONS } from "$lib/config/function-presets";
import { PRESETS } from "$lib/config/presets";
import {
  prepareTemplateImport,
  type TemplateFile,
} from "$lib/config/template-file";
import { saveFormulas } from "$lib/formulas.svelte.js";
import { saveFunctions } from "$lib/functions.svelte.js";
import {
  getFormulas,
  isFormulasWritable,
  upsertFormula,
} from "$lib/stores/formulas.svelte";
import {
  getFunctions,
  isFunctionsWritable,
  upsertFunction,
} from "$lib/stores/functions.svelte";
import {
  commitLogics,
  getLogicDocument,
  isLogicsWritable,
  logicBlocked,
} from "$lib/stores/logics.svelte";
import { saveTemplateBundles } from "$lib/template-bundles.svelte.js";
import {
  getTemplateBundles,
  isTemplateBundlesWritable,
  upsertTemplateBundle,
} from "$lib/stores/template-bundles.svelte";
import {
  commitTemplates,
  getTemplateRegistry,
  isTemplatesWritable,
} from "$lib/stores/templates.svelte.js";
import { BUILTIN_TEMPLATES } from "$logic/templates";
import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import type { DeviceTemplate, LogicTemplate } from "$logic/types";
import type { TemplateBundle } from "$lib/types/templates";

export function installTemplateFile(
  file: TemplateFile,
  name?: string,
): { id: string } | { problem: string } {
  switch (file.kind) {
    case "formula": {
      if (!isFormulasWritable()) {
        return {
          problem:
            "Formula templates could not be loaded — the import was not saved.",
        };
      }
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        getFormulas().map((template) => template.id),
        name,
      );
      upsertFormula(next.definition as unknown as FormulaTemplate);
      saveFormulas();
      return { id: next.id };
    }

    case "snippet": {
      if (!isFunctionsWritable()) {
        return {
          problem:
            "Function templates could not be loaded — the import was not saved.",
        };
      }
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        [
          ...getFunctions().map((template) => template.id),
          ...BUILTIN_FUNCTIONS.map((template) => template.id),
        ],
        name,
      );
      upsertFunction(next.definition as unknown as FunctionTemplate);
      saveFunctions();
      return { id: next.id };
    }

    case "device": {
      if (!isTemplatesWritable()) {
        return {
          problem:
            "Device templates could not be loaded — the import was not saved.",
        };
      }
      const registry = getTemplateRegistry();
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        [
          ...Object.values(PRESETS).map((template) => template.id),
          ...(registry.templates ?? []).map((template) => template.id),
        ],
        name,
      );
      if (
        !commitTemplates({
          ...registry,
          templates: [
            ...(registry.templates ?? []),
            next.definition as unknown as Template,
          ],
        })
      ) {
        return {
          problem: "The device template document could not be saved.",
        };
      }
      return { id: next.id };
    }

    case "logic": {
      if (!isLogicsWritable()) {
        return {
          problem:
            "Logic templates could not be loaded — the import was not saved.",
        };
      }
      if (logicBlocked()) {
        return {
          problem: "The logic document has errors — fix them before importing.",
        };
      }
      const doc = getLogicDocument();
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        [
          ...BUILTIN_TEMPLATES.map((template) => template.id),
          ...(doc.templates ?? []).map((template) => template.id),
        ],
        name,
      );
      if (
        !commitLogics({
          ...doc,
          templates: [
            ...(doc.templates ?? []),
            next.definition as unknown as LogicTemplate,
          ],
        })
      ) {
        return { problem: "The logic document could not be saved." };
      }
      if (logicBlocked()) {
        return {
          problem: "The logic document has errors — the import was not saved.",
        };
      }
      return { id: next.id };
    }

    case "api": {
      if (!isLogicsWritable()) {
        return {
          problem:
            "API templates could not be loaded — the import was not saved.",
        };
      }
      if (logicBlocked()) {
        return {
          problem: "The logic document has errors — fix them before importing.",
        };
      }
      const doc = getLogicDocument();
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        [
          ...BUILTIN_DEVICE_TEMPLATES.map((template) => template.id),
          ...(doc.deviceTemplates ?? []).map((template) => template.id),
        ],
        name,
      );
      if (
        !commitLogics({
          ...doc,
          deviceTemplates: [
            ...(doc.deviceTemplates ?? []),
            next.definition as unknown as DeviceTemplate,
          ],
        })
      ) {
        return { problem: "The logic document could not be saved." };
      }
      if (logicBlocked()) {
        return {
          problem: "The logic document has errors — the import was not saved.",
        };
      }
      return { id: next.id };
    }

    case "bundle": {
      if (!isTemplateBundlesWritable()) {
        return {
          problem:
            "Combined templates could not be loaded — the import was not saved.",
        };
      }
      const next = prepareTemplateImport(
        file.kind,
        file.definition,
        getTemplateBundles().map((bundle) => bundle.id),
        name,
      );
      if (!upsertTemplateBundle(next.definition as unknown as TemplateBundle)) {
        return { problem: "Combined templates could not be saved." };
      }
      saveTemplateBundles();
      return { id: next.id };
    }
  }
}
