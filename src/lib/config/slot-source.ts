import type {
  Control,
  EnrichedControl,
  EnrichedDevice,
  Widget,
} from "$lib/types/device";
import type { SlotSource } from "$lib/types/display";
import { stateIdFor, type GlobalVariable } from "$lib/config/variables";
import {
  effectiveCommon,
  normalizeStates,
  widgetForMeta,
} from "$lib/config/state-meta";

/** What the resolver reads: the enriched devices and the broker caches. */
export interface SourceLook {
  devices: EnrichedDevice[];
  states: Map<string, any>;
  objects: Map<string, any>;
  /** A raw-state source may name a variable; the library maps it to its state. */
  variables?: GlobalVariable[];
}

/** A slot's source, resolved for rendering and writing. */
export interface ResolvedSource {
  value: unknown;
  writable: boolean;
  available: boolean;
  stateId?: string;
  /** Every state behind a device source: its badge clock reads the newest. */
  stateIds?: string[];
  object?: any;
  control?: EnrichedControl;
  widget?: Widget;
  unit?: string;
  label?: string;
  role?: string;
  type?: string;
  states?: Record<string, string>;
}

/**
 * The one way a slot reads: a device control (live, through the device's
 * transform/virtual layer), a raw state, or a device (badges). Absent source or
 * a missing device/control → unavailable, never a throw.
 */
export function resolveSlotSource(
  source: SlotSource | undefined,
  look: SourceLook,
): ResolvedSource | undefined {
  if (!source) return undefined;
  if (source.kind === "control") {
    const device = look.devices.find((d) => d.id === source.device);
    const control: EnrichedControl | undefined = device?.controls?.find(
      (c) => c.id === source.control,
    );
    if (!control)
      return { value: undefined, writable: false, available: false };
    const available = control.available === true;
    return {
      value:
        control.liveValue ??
        (control.stateId ? look.states.get(control.stateId)?.val : undefined),
      writable: available && control.writable === true,
      available,
      stateId: control.stateId,
      object: control.object,
      control,
      widget: control.widget,
      unit: control.meta?.unit ?? control.unit,
      label: control.label ?? control.feature,
      role: control.meta?.role,
      type: control.meta?.type,
      states: control.meta?.states,
    };
  }
  if (source.kind === "state") {
    const stateId = stateIdFor(source.stateId, look.variables ?? []);
    const object = look.objects.get(stateId);
    const state = look.states.get(stateId);
    return {
      value: state?.val,
      writable: object?.common?.write === true,
      available: !!object || state !== undefined,
      stateId,
      object,
      widget: widgetForState(object),
      unit: object?.common?.unit,
      label: object?.common?.name,
      role: object?.common?.role,
      type: object?.common?.type,
      states: normalizeStates(object?.common?.states),
    };
  }
  const device = look.devices.find((d) => d.id === source.device);
  if (!device) return { value: undefined, writable: false, available: false };
  return {
    value: undefined,
    writable: false,
    available: (device.controls ?? []).some((c) => c.available === true),
    stateIds: (device.controls ?? [])
      .map((c) => c.stateId)
      .filter((id): id is string => !!id),
    label: device.name,
  };
}

/** The widget a raw state suggests (a slot may override it). Same inference as
 *  a control, with no device-type fallback. */
export function widgetForState(object: any): Widget {
  const neutral = { id: "", feature: "", writable: false } as Control;
  return widgetForMeta(effectiveCommon(neutral, object));
}

/** Every state id a source needs subscribed. Control sources resolve through
 *  the device registry; a device source needs none (its controls are watched). */
export function sourceStateIds(
  source: SlotSource | undefined,
  devices: EnrichedDevice[],
  variables: GlobalVariable[] = [],
): string[] {
  if (!source) return [];
  if (source.kind === "state") return [stateIdFor(source.stateId, variables)];
  if (source.kind === "device") return [];
  const device = devices.find((d) => d.id === source.device);
  const stateId = device?.controls?.find(
    (c) => c.id === source.control,
  )?.stateId;
  return stateId ? [stateId] : [];
}
