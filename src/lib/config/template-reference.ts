import type { Device } from "$lib/types/device";
import type { SlotSource } from "$lib/types/display";
import { resolveVariable, type GlobalVariable } from "./variables";

/** A stored reference, the state it resolves to, and the broker object. */
export interface TemplateReference {
  /** What is stored on the control: state id or variable name. */
  ref: string;
  /** The real broker state id. */
  stateId: string;
  object: any;
}

/**
 * Resolve a picked reference for the create-device flow. A bare name is a
 * state variable; a dotted name is a raw state id. Constants are not controls.
 */
export function resolveTemplateReference(
  ref: string,
  objects: Map<string, any>,
  variables: GlobalVariable[],
): { reference: TemplateReference } | { problem: string } {
  const value = String(ref ?? "").trim();
  if (!value) return { problem: "Choose a state." };
  if (!value.includes(".")) {
    const variable = resolveVariable(value, variables);
    if (!variable) return { problem: `Variable ${value} not found.` };
    if (variable.kind === "constant") {
      return { problem: "A constant cannot back a device control." };
    }
    if (!variable.stateId) {
      return { problem: `Variable ${value} has no state.` };
    }
    const object = objects.get(variable.stateId);
    if (!object) {
      return { problem: `State ${variable.stateId} does not exist.` };
    }
    return {
      reference: { ref: value, stateId: variable.stateId, object },
    };
  }
  const object = objects.get(value);
  if (!object) return { problem: `State ${value} does not exist.` };
  return { reference: { ref: value, stateId: value, object } };
}

/** The reference a picked slot source stands for; a device source has none. */
export function referenceFromSource(
  source: SlotSource,
  devices: Device[],
): string | undefined {
  if (source.kind === "state") return source.stateId;
  if (source.kind !== "control") return undefined;
  return devices
    .find((device) => device.id === source.device)
    ?.controls?.find((control) => control.id === source.control)?.stateId;
}
