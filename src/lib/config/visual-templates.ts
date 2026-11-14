import { DEVICE_TYPES } from "$lib/config/features";
import { SIZE_MAX_H, SIZE_MAX_W } from "$lib/config/size-ops";
import type { DeviceType } from "$lib/types/device";
import type { ActiveOp, Template } from "$lib/types/display";

const ACTIVE_OPS: ActiveOp[] = ["truthy", "gt", "gte", "lt", "lte", "eq", "ne"];

function featureProblem(features: unknown): string | null {
  if (!Array.isArray(features)) return "features must be an array.";
  const seen = new Set<string>();
  let primaries = 0;
  for (const item of features) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "Each feature must be an object.";
    }
    const feature = item as Record<string, unknown>;
    if (typeof feature.feature !== "string" || !feature.feature.trim()) {
      return "Each feature needs a non-empty feature key.";
    }
    if (seen.has(feature.feature)) {
      return `Duplicate feature key: ${feature.feature}.`;
    }
    seen.add(feature.feature);
    if (typeof feature.label !== "string" || !feature.label.trim()) {
      return `Feature ${feature.feature} needs a label.`;
    }
    if (typeof feature.widget !== "string" || !feature.widget) {
      return `Feature ${feature.feature} needs a widget.`;
    }
    if (
      !Array.isArray(feature.roleHints) ||
      feature.roleHints.some((hint) => typeof hint !== "string")
    ) {
      return `Feature ${feature.feature} needs roleHints as strings.`;
    }
    if (
      feature.required !== undefined &&
      typeof feature.required !== "boolean"
    ) {
      return `Feature ${feature.feature}: required must be a boolean.`;
    }
    if (feature.primary === true) primaries++;
    if (feature.primary !== undefined && typeof feature.primary !== "boolean") {
      return `Feature ${feature.feature}: primary must be a boolean.`;
    }
  }
  if (primaries > 1) return "A template can have only one primary feature.";
  return null;
}

function activeProblem(active: unknown): string | null {
  if (active === undefined) return null;
  if (!active || typeof active !== "object" || Array.isArray(active)) {
    return "active must be an object.";
  }
  const condition = active as Record<string, unknown>;
  const source = condition.source;
  if (
    typeof source !== "string" &&
    (!source || typeof source !== "object" || Array.isArray(source))
  ) {
    return "active.source must be a string or a source object.";
  }
  if (!ACTIVE_OPS.includes(condition.op as ActiveOp)) {
    return "active.op is not a known operator.";
  }
  if (condition.value !== undefined && typeof condition.value !== "string") {
    return "active.value must be a string.";
  }
  return null;
}

/** A strict check for a user visual template; returns the first problem. */
export function visualTemplateProblem(
  value: unknown,
  takenIds: Iterable<string>,
  currentId?: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "A template must be an object.";
  }
  const template = value as Partial<Template>;
  if (typeof template.id !== "string" || !template.id.trim()) {
    return "A template needs a non-empty id.";
  }
  const taken = new Set(takenIds);
  if (template.id !== currentId && taken.has(template.id)) {
    return `Template id ${template.id} is already used.`;
  }
  if (typeof template.name !== "string" || !template.name.trim()) {
    return "A template needs a name.";
  }
  if (typeof template.type !== "string" || !template.type) {
    return "A template needs a type.";
  }
  if (!DEVICE_TYPES.includes(template.type as DeviceType)) {
    return `Unknown device type: ${template.type}.`;
  }
  const featureIssue = featureProblem(template.features);
  if (featureIssue) return featureIssue;
  if (!Array.isArray(template.slots)) {
    return "slots must be an array.";
  }
  for (const slot of template.slots) {
    if (!slot || typeof slot !== "object" || typeof slot.kind !== "string") {
      return "Each slot needs a kind.";
    }
    if (slot.rules !== undefined && !Array.isArray(slot.rules)) {
      return "Slot rules must be an array.";
    }
  }
  if (template.basedOn !== undefined && typeof template.basedOn !== "string") {
    return "basedOn must be a string.";
  }
  if (template.builtin !== undefined && typeof template.builtin !== "boolean") {
    return "builtin must be a boolean.";
  }
  const activeIssue = activeProblem(template.active);
  if (activeIssue) return activeIssue;
  if (
    template.look !== undefined &&
    (!template.look ||
      typeof template.look !== "object" ||
      Array.isArray(template.look))
  ) {
    return "look must be an object.";
  }
  if (template.size !== undefined) {
    const size = template.size as { w?: unknown; h?: unknown };
    if (
      !size ||
      typeof size.w !== "number" ||
      typeof size.h !== "number" ||
      size.w < 1 ||
      size.w > SIZE_MAX_W ||
      size.h < 1 ||
      size.h > SIZE_MAX_H
    ) {
      return `size needs w between 1 and ${SIZE_MAX_W} and h between 1 and ${SIZE_MAX_H}.`;
    }
  }
  return null;
}
