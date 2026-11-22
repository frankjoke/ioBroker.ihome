import { getVariables, upsertVariable } from "$lib/stores/variables.svelte";
import { saveVariables } from "$lib/variables.svelte.js";
import { newId } from "$lib/utils/ids";
import {
  nameTaken,
  restrictName,
  splitStateId,
  validName,
  type GlobalVariable,
} from "./variables";
import type { PluginCollection } from "$adapter/plugin-collection-types";

/**
 * An installed collection creates broker states, but the SPA's variable list is
 * a separate document. Recreate the obvious alias for every owned state so
 * logic captured with that alias resolves on the target too.
 */
export function importCollectionVariables(
  collection: PluginCollection | undefined,
): void {
  if (!collection) return;
  let changed = false;
  for (const state of collection.states) {
    if (state.type !== "state") continue;
    const variables = getVariables();
    if (variables.some((variable) => variable.stateId === state.id)) continue;
    const common = state.common as Record<string, unknown>;
    const leaf = splitStateId(state.id).relative.split(".").pop() ?? state.id;
    const name = restrictName(String(common?.name ?? leaf));
    if (!name || !validName(name) || nameTaken(variables, name)) continue;
    const value: GlobalVariable = {
      id: newId(),
      name,
      kind: "state",
      stateId: state.id,
      type: String(common?.type ?? "mixed"),
      ...(common?.unit ? { unit: String(common.unit) } : {}),
      ...(common?.role ? { role: String(common.role) } : {}),
      ...(common?.min !== undefined && Number.isFinite(Number(common.min))
        ? { min: Number(common.min) }
        : {}),
      ...(common?.max !== undefined && Number.isFinite(Number(common.max))
        ? { max: Number(common.max) }
        : {}),
      ...(common?.step !== undefined && Number.isFinite(Number(common.step))
        ? { step: Number(common.step) }
        : {}),
      ...(common?.states && typeof common.states === "object"
        ? { states: common.states as Record<string, string> }
        : {}),
    };
    upsertVariable(value);
    changed = true;
  }
  if (changed) saveVariables();
}
