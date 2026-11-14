import type { Control, Device } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import { templateFeatures } from "./template-ops";

export interface DeviceTemplateFill {
  feature: string;
  /** The reference stored on the control (state id or variable name). */
  ref: string;
  /** The resolved broker state id. */
  stateId: string;
  object: any;
}

export interface CreateDeviceInput {
  template: Template;
  name: string;
  room?: string;
  icon?: string;
  fills: DeviceTemplateFill[];
  newId: () => string;
  newControlId: () => string;
}

/** Build a complete device from the filled template features, or the reason not. */
export function planDeviceCreate(
  input: CreateDeviceInput,
): { device: Device } | { problem: string } {
  const name = input.name.trim();
  if (!name) return { problem: "Give the device a name." };

  const features = new Map(
    templateFeatures(input.template).map((feature) => [
      feature.feature,
      feature,
    ]),
  );
  const seen = new Set<string>();
  for (const fill of input.fills) {
    if (!features.has(fill.feature)) {
      return { problem: `Unknown feature: ${fill.feature}.` };
    }
    if (seen.has(fill.feature)) {
      return { problem: `Feature ${fill.feature} is filled twice.` };
    }
    seen.add(fill.feature);
  }
  for (const feature of features.values()) {
    if (feature.required && !seen.has(feature.feature)) {
      return { problem: `${feature.label} is required.` };
    }
  }

  const controls: Control[] = input.fills.map((fill) => {
    const feature = features.get(fill.feature)!;
    const unit = fill.object?.common?.unit;
    return {
      id: input.newControlId(),
      feature: fill.feature,
      stateId: fill.ref,
      writable: fill.object?.common?.write === true,
      label: feature.label,
      ...(typeof unit === "string" && unit ? { unit } : {}),
    };
  });

  return {
    device: {
      id: input.newId(),
      name,
      type: input.template.type,
      ...(input.room ? { room: input.room } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
      template: input.template.id,
      controls,
    },
  };
}
