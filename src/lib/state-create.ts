import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  isOwnedState,
  stateCommonDiff,
  stateObjectWithDiff,
  type StateSpec,
} from "$logic/state-common";

export type EnsureStateResult =
  "created" | "updated" | "unchanged" | "foreign-skipped";

/** Read an object without confusing a failed read with a missing object. */
export async function readStateObject(
  id: string,
): Promise<Record<string, unknown> | undefined> {
  if (!ioBroker.connected) throw new Error("Not connected to ioBroker");
  const cached = ioBroker.objects?.get(id);
  if (cached) return cached as Record<string, unknown>;
  const object = await ioBroker.emitAsync("getObject", id);
  return (object as Record<string, unknown> | undefined) ?? undefined;
}

/**
 * Create a missing owned state or update only the common keys that differ.
 * Equal objects are left untouched; existing foreign states are never touched.
 */
export async function ensureStateObject(
  spec: StateSpec,
): Promise<EnsureStateResult> {
  const existing = await readStateObject(spec.id);
  if (existing) {
    if (!isOwnedState(spec.id, ioBroker.namespace)) return "foreign-skipped";
    if (existing.type !== "state") {
      throw new Error(`${spec.id} exists but is not a state`);
    }
    const diff = stateCommonDiff(
      existing.common as Record<string, unknown>,
      spec.common,
    );
    if (!diff) return "unchanged";
    const next = stateObjectWithDiff(existing, diff);
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
