import type { Control } from "$lib/types/device";

/**
 * Point an existing control at another state. The state-derived fields
 * (stateId, feature, writable) follow the picked state; a label/unit the user
 * typed is kept, while one that still holds the old state's default is
 * refreshed. Everything else (transform, history, rules, hidden) stays.
 */
export function applyPickedState(
  control: Control,
  picked: Control,
  previousDefaults: { label?: string; unit?: string } = {},
): Control {
  const keep = (
    current: string | undefined,
    wasDefault: string | undefined,
    next: string | undefined,
  ) => ((current ?? "") === (wasDefault ?? "") ? next : current);

  return {
    ...control,
    stateId: picked.stateId,
    feature: picked.feature,
    writable: picked.writable,
    label: keep(control.label, previousDefaults.label, picked.label),
    unit: keep(control.unit, previousDefaults.unit, picked.unit),
  };
}
