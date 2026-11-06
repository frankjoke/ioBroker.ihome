import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { ensureStateObject } from "$lib/state-create";
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
  const parts = baseState.split(".").filter(Boolean);
  if (parts.length < 3) {
    throw new Error("base state needs adapter.instance.name");
  }
  let id = parts.slice(0, 2).join(".");
  for (const part of parts.slice(2)) {
    id += `.${part}`;
    const known =
      ioBroker.objects?.get(id) ?? (await ioBroker.getObject(id, true));
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
  for (const spec of specs) {
    await ensureStateObject(spec);
  }
}
