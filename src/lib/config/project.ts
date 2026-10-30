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
    // Metadata corrections (spec §3); all optional.
    role: c.role,
    type: c.type,
    states: c.states,
    hideUnit: c.hideUnit,
    min: c.min,
    max: c.max,
    step: c.step,
    read: c.read,
    write: c.write,
    room: c.room,
    functions: c.functions,
    common: c.common,
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
    title: d.title,
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
