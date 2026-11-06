import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  isOwnedState,
  stateCommonDiff,
  type StateSpec,
} from "$logic/state-common";

export type EnsureStateResult =
  | "created"
  | "updated"
  | "unchanged"
  | "foreign-skipped";

/**
 * Create a missing owned state or update only the common keys that differ.
 * Equal objects are left untouched; existing foreign states are never touched.
 */
export async function ensureStateObject(
  spec: StateSpec,
): Promise<EnsureStateResult> {
  const cached = ioBroker.objects?.get(spec.id);
  const existing = cached ?? (await ioBroker.getObject(spec.id, true));
  if (existing) {
    if (!isOwnedState(spec.id, ioBroker.namespace)) return "foreign-skipped";
    const diff = stateCommonDiff(
      existing.common as Record<string, unknown>,
      spec.common,
    );
    if (!diff) return "unchanged";
    const next = {
      ...existing,
      common: { ...existing.common, ...diff },
    };
    await ioBroker.emitAsync("setObject", spec.id, next);
    ioBroker.objects?.update(spec.id, next);
    return "updated";
  }
  const object = {
    _id: spec.id,
    type: "state",
    common: spec.common,
    native: {},
  };
  await ioBroker.emitAsync("setObject", spec.id, object);
  ioBroker.objects?.update(spec.id, object);
  if (spec.initial !== undefined) {
    await ioBroker.setState(spec.id, spec.initial);
  }
  return "created";
}
