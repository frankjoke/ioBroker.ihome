import { deviceTemplateProblem } from "$lib/config/device-templates";
import { formulaTemplateProblem } from "$lib/config/formulas";
import { functionTemplateProblem } from "$lib/config/functions";
import { logicTemplateProblem } from "$lib/config/logic-templates";
import { slugify } from "$lib/config/slug";
import { templateBundleProblem } from "$lib/config/template-bundles";
import { visualTemplateProblem } from "$lib/config/visual-templates";
import { newId } from "$lib/utils/ids";
import type { FunctionTemplate } from "$lib/types/device";

export const TEMPLATE_KINDS = [
  "formula",
  "snippet",
  "device",
  "logic",
  "api",
  "bundle",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface TemplateFile {
  format: "ihome-template";
  version: 1;
  kind: TemplateKind;
  definition: unknown;
}

export function templateFile(
  kind: TemplateKind,
  definition: unknown,
): TemplateFile {
  return { format: "ihome-template", version: 1, kind, definition };
}

export function serializeTemplateFile(file: TemplateFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function definitionProblem(kind: TemplateKind, value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "The template definition must be an object.";
  }
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) {
    return "The template needs a non-empty id.";
  }
  switch (kind) {
    case "formula":
      return formulaTemplateProblem(value);
    case "snippet":
      return functionTemplateProblem(value as FunctionTemplate);
    case "device":
      return visualTemplateProblem(value, [], id);
    case "logic":
      return logicTemplateProblem(value, [], [], id);
    case "api":
      return deviceTemplateProblem(value);
    case "bundle":
      return templateBundleProblem(value, [], [], id);
  }
}

export function parseTemplateFile(
  raw: unknown,
): { file: TemplateFile } | { problem: string } {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { problem: "The file is not valid JSON." };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { problem: "The file must contain a template object." };
  }
  const wrapper = value as Record<string, unknown>;
  if (wrapper.format !== "ihome-template") {
    return {
      problem: 'Not an iHome template file (format must be "ihome-template").',
    };
  }
  if (wrapper.version !== 1) {
    return {
      problem: `Unsupported template file version: ${String(wrapper.version)}.`,
    };
  }
  if (!TEMPLATE_KINDS.includes(wrapper.kind as TemplateKind)) {
    return { problem: `Unknown template kind: ${String(wrapper.kind)}.` };
  }
  const kind = wrapper.kind as TemplateKind;
  const problem = definitionProblem(kind, wrapper.definition);
  if (problem) return { problem };
  return {
    file: {
      format: "ihome-template",
      version: 1,
      kind,
      definition: wrapper.definition,
    },
  };
}

export function prepareTemplateImport(
  kind: TemplateKind,
  definition: unknown,
  takenIds: Iterable<string>,
): { definition: Record<string, unknown>; id: string; renamed: boolean } {
  const clone = JSON.parse(JSON.stringify(definition)) as Record<
    string,
    unknown
  >;
  const taken = new Set(takenIds);
  const renamed = typeof clone.id === "string" && taken.has(clone.id);
  if (renamed) {
    clone.id = newId();
    clone.name = `${String(clone.name)} (imported)`;
  }
  if (kind === "device") clone.builtin = false;
  return { definition: clone, id: String(clone.id), renamed };
}

export function templateExport(
  kind: TemplateKind,
  definition: unknown,
): { fileName: string; text: string } {
  const name = (definition as { name?: unknown } | null)?.name;
  const slug = slugify(typeof name === "string" ? name : "") || "template";
  return {
    fileName: `ihome-${kind}-${slug}.json`,
    text: serializeTemplateFile(templateFile(kind, definition)),
  };
}

export function templateGroup(kind: TemplateKind): "code" | "templates" {
  return kind === "formula" || kind === "snippet" ? "code" : "templates";
}
