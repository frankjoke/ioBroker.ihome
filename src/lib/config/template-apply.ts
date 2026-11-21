import { uniqueSlug } from "$lib/config/slug";
import { parseDuration } from "$logic/duration";
import { instantiateTemplate } from "$logic/templates";
import { validateLogicDocument } from "$logic/validate";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";
import type { LogicDef, LogicTemplate, TemplateParam } from "$logic/types";

export type ApplyParam = {
  name: string;
  label: string;
  type: "string" | "state" | "memory" | "number" | "boolean" | "duration";
  default?: string | number | boolean;
  description?: string;
};

export type ApplyPart = "api" | "logic";

/** Initial apply-form values for a logic template's params. */
export function logicApplyDefaults(
  params: ApplyParam[],
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const param of params) {
    if (param.default !== undefined) values[param.name] = param.default;
    else if (param.type === "number") values[param.name] = 0;
    else if (param.type === "boolean") values[param.name] = false;
    else if (param.type === "duration") values[param.name] = "30s";
    else values[param.name] = "";
  }
  return values;
}

/** Resolve state refs and check durations/required values before applying. */
export function resolveTemplateParams(
  params: ApplyParam[],
  values: Record<string, string | number | boolean>,
  resolveStateRef: (ref: string) => string,
): { values: Record<string, string | number | boolean> } | { problem: string } {
  const next = { ...values };
  for (const param of params) {
    const raw = next[param.name];
    if (param.type === "state") {
      const ref = String(raw ?? "").trim();
      if (!ref) return { problem: `${param.label}: choose a state.` };
      next[param.name] = resolveStateRef(ref);
      continue;
    }
    if (param.type === "duration") {
      if (parseDuration(String(raw ?? "")) === null) {
        return { problem: `${param.label}: use e.g. 30s, 5m or 1h.` };
      }
      continue;
    }
    if (param.type === "string") continue;
    if (raw === undefined || raw === "") {
      if (param.default === undefined) {
        return { problem: `${param.label} is required.` };
      }
      next[param.name] = param.default;
    }
  }
  return { values: next };
}

/** Instantiate and validate a logic template for insertion, or the reason not. */
export function planLogicApply(
  template: LogicTemplate,
  values: Record<string, string | number | boolean>,
  takenIds: Iterable<string>,
  existingLogics: LogicDef[] = [],
): { logic: LogicDef } | { problem: string } {
  try {
    const logic = instantiateTemplate(
      template,
      values,
      uniqueSlug(template.id, takenIds),
    );
    const issues = validateLogicDocument({
      version: 3,
      logics: [...existingLogics, logic],
    }).filter((issue) => issue.severity === "error");
    if (issues.length > 0) {
      return { problem: `${issues[0].path}: ${issues[0].message}` };
    }
    return { logic };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
}

/** Parts present in a bundle, in apply order. A stored device part is a tile
 *  template, applied from the tile editor; the bundle applies its API/logic
 *  parts only. */
export function bundleApplyParts(bundle: TemplateBundle): ApplyPart[] {
  const parts: ApplyPart[] = [];
  if (bundle.api) parts.push("api");
  if (bundle.logic) parts.push("logic");
  return parts;
}

/** The bundle's device part as a reusable user tile template. */
export function bundleDeviceTemplate(
  bundle: TemplateBundle,
  takenIds: Iterable<string>,
): Template | null {
  if (!bundle.device) return null;
  return {
    ...bundle.device,
    id: uniqueSlug(bundle.id, takenIds),
    name: bundle.name,
    type: bundle.device.type ?? "Custom",
    basedOn: bundle.id,
  };
}

const LOGIC_PARAM_TYPES = new Set<ApplyParam["type"]>([
  "state",
  "memory",
  "number",
  "boolean",
  "duration",
]);

/** Shared params the Logic part understands, without the API-only types. */
export function bundleLogicParams(bundle: TemplateBundle): TemplateParam[] {
  return (bundle.params ?? [])
    .filter((param) => LOGIC_PARAM_TYPES.has(param.type))
    .map((param) => ({
      name: param.name,
      label: param.label,
      type: param.type as TemplateParam["type"],
      ...(param.default !== undefined ? { default: param.default } : {}),
      ...(param.description ? { description: param.description } : {}),
    }));
}

export function applyPartLabel(part: ApplyPart): string {
  return part === "api" ? "API" : "Logic";
}

/** Run the parts in order; the first throw stops and names its part. */
export async function runApplyParts(
  parts: ApplyPart[],
  run: (part: ApplyPart) => Promise<void>,
): Promise<{ part: ApplyPart; error: string } | null> {
  for (const part of parts) {
    try {
      await run(part);
    } catch (e) {
      return {
        part,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return null;
}
