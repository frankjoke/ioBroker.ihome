import { uniqueSlug } from "$lib/config/slug";
import { parseDuration } from "$logic/duration";
import { instantiateTemplate } from "$logic/templates";
import { validateLogicDocument } from "$logic/validate";
import type { Device } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import type { LogicDef, LogicTemplate, TemplateParam } from "$logic/types";

/** Devices a visual template may be applied to, sorted by name. */
export function devicesForTemplate(
  template: Template,
  devices: Device[],
): Device[] {
  return devices
    .filter((device) => device.type === template.type)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The target device with the template id, or the reason it cannot be used. */
export function planDeviceApply(
  template: Template,
  device: Device | undefined,
): { device: Device } | { problem: string } {
  if (!device) {
    return { problem: "Choose a device to apply the template to." };
  }
  if (device.type !== template.type) {
    return {
      problem: `The template is for ${template.type} devices, but ${device.name} is a ${device.type} device.`,
    };
  }
  return { device: { ...device, template: template.id } };
}

/** Initial apply-form values for a logic template's params. */
export function logicApplyDefaults(
  params: TemplateParam[],
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
  params: TemplateParam[],
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
