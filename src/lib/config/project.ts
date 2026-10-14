import type { Control, Device } from "$lib/types/device";

/** Keep only the persisted model fields of a control (drop enriched extras). */
export function projectControl(c: Control): Control {
  return {
    id: c.id,
    kind: c.kind,
    feature: c.feature,
    stateId: c.stateId,
    writable: c.writable,
    label: c.label,
    unit: c.unit,
    hidden: c.hidden,
    transform: c.transform,
    virtual: c.virtual,
    formulaId: c.formulaId,
    history: c.history,
    rules: c.rules,
  };
}

/** Keep only the persisted model fields of a device and its controls. */
export function projectDevice(d: Device): Device {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    room: d.room,
    section: d.section,
    panel: d.panel,
    icon: d.icon,
    functions: d.functions,
    favorites: d.favorites,
    tags: d.tags,
    template: d.template,
    size: d.size,
    slots: d.slots,
    watch: d.watch,
    controls: (d.controls ?? []).map(projectControl),
  };
}
