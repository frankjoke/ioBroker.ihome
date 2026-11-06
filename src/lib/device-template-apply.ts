import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { ensureStateObject, readStateObject } from "$lib/state-create";
import {
  buildDeviceLogic,
  templateStateSpecs,
  validateDeviceTemplate,
} from "$logic/device-templates";
import { validateLogicDocument } from "$logic/validate";
import type { StateSpec } from "$logic/state-common";
import type { DeviceTemplateShape, MachineLogic } from "$logic/types";

export interface DeviceTemplatePlan {
  specs: StateSpec[];
  logic: MachineLogic;
}

/** Build the state list and machine without touching the broker. */
export function planDeviceTemplate(
  template: DeviceTemplateShape,
  source: string,
  params: Record<string, unknown>,
  baseState: string,
  id: string,
  name: string,
): DeviceTemplatePlan {
  const check = validateDeviceTemplate(template);
  if (check.errors.length > 0) throw new Error(check.errors[0]);
  const specs = templateStateSpecs(template, baseState);
  const logic = buildDeviceLogic(template, source, params, baseState, id, name);
  const issues = validateLogicDocument({ version: 3, logics: [logic] }).filter(
    (issue) => issue.severity === "error",
  );
  if (issues.length > 0) {
    throw new Error(`${issues[0].path}: ${issues[0].message}`);
  }
  return { specs, logic };
}

/** Create each missing folder below the namespace, never above it. */
async function ensureFolderPath(baseState: string): Promise<void> {
  const namespace = ioBroker.namespace;
  if (!namespace) throw new Error("Not connected to ioBroker");
  const prefix = `${namespace}.`;
  if (!baseState.startsWith(prefix)) {
    throw new Error(`base state must start with ${prefix}`);
  }
  const parts = baseState.slice(prefix.length).split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("base state needs a folder name");
  if (
    ["Logic", "config", "info", "phone", "system", "enum"].includes(parts[0])
  ) {
    throw new Error(`base state may not use the ${parts[0]} folder`);
  }
  let id = namespace;
  for (const part of parts) {
    id += `.${part}`;
    const known = await readStateObject(id);
    if (known) {
      if (known.type !== "folder") throw new Error(`${id} is not a folder`);
      continue;
    }
    const folder = {
      _id: id,
      type: "folder",
      common: { name: part },
      native: {},
    };
    await ioBroker.emitAsync("setObject", id, folder);
    ioBroker.objects?.update(id, folder);
  }
}

/** Create or update the template states; throws before the logic is inserted. */
export async function createTemplateStates(
  specs: StateSpec[],
  baseState: string,
): Promise<void> {
  await ensureFolderPath(baseState);
  const skipped: string[] = [];
  for (const spec of specs) {
    const result = await ensureStateObject(spec);
    if (result === "foreign-skipped") skipped.push(spec.id);
  }
  if (skipped.length > 0) {
    throw new Error(
      `existing foreign states were not overwritten: ${skipped.join(", ")}`,
    );
  }
}
