import type { Control } from "$lib/types/device";

/**
 * Point an existing control at another state. The state-derived fields
 * (stateId, feature, writable) follow the picked state; a label/unit the user
 * typed is kept, while one that still holds the old state's default is
 * refreshed. Everything else (transform, history, rules, hidden) stays.
 */
/**
 * Make a device's control labels unique: a repeated name gets "2", "3", …
 * appended (the display name is the label, else the feature). The first keeps
 * its name; untouched controls stay the same objects.
 */
export function uniqueControlLabels(controls: Control[]): Control[] {
  const used = new Set<string>();
  return controls.map((control) => {
    const base = (control.label ?? "").trim() || control.feature || control.id;
    let label = base;
    if (used.has(label)) {
      let n = 2;
      while (used.has(`${base}${n}`)) n++;
      label = `${base}${n}`;
    }
    used.add(label);
    return label === control.label ? control : { ...control, label };
  });
}

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
