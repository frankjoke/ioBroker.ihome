import { DEVICE_TYPES } from "$lib/config/features";
import type { DeviceType } from "$lib/types/device";
import type { Template } from "$lib/types/display";

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
  if (!Array.isArray(template.features)) {
    return "features must be an array.";
  }
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
  if (template.size !== undefined) {
    const size = template.size as { w?: unknown; h?: unknown };
    if (
      !size ||
      typeof size.w !== "number" ||
      typeof size.h !== "number" ||
      size.w < 1 ||
      size.w > 20 ||
      size.h < 1 ||
      size.h > 10
    ) {
      return "size needs w between 1 and 20 and h between 1 and 10.";
    }
  }
  return null;
}
