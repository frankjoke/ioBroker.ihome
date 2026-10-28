import type {
  EnrichedControl,
  EnrichedDevice,
  Widget,
} from "$lib/types/device";
import type { SlotSource } from "$lib/types/display";

/** What the resolver reads: the enriched devices and the broker caches. */
export interface SourceLook {
  devices: EnrichedDevice[];
  states: Map<string, any>;
  objects: Map<string, any>;
}

/** A slot's source, resolved for rendering and writing. */
export interface ResolvedSource {
  value: unknown;
  writable: boolean;
  available: boolean;
  stateId?: string;
  object?: any;
  control?: EnrichedControl;
  widget?: Widget;
  unit?: string;
  label?: string;
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
      unit: control.unit,
      label: control.label ?? control.feature,
    };
  }
  if (source.kind === "state") {
    const object = look.objects.get(source.stateId);
    const state = look.states.get(source.stateId);
    return {
      value: state?.val,
      writable: object?.common?.write === true,
      available: !!object || state !== undefined,
      stateId: source.stateId,
      object,
      widget: widgetForState(object),
      unit: object?.common?.unit,
      label: object?.common?.name,
    };
  }
  const device = look.devices.find((d) => d.id === source.device);
  if (!device) return { value: undefined, writable: false, available: false };
  return {
    value: undefined,
    writable: false,
    available: (device.controls ?? []).some((c) => c.available === true),
    label: device.name,
  };
}

/** The widget a raw state suggests (a slot may override it). */
export function widgetForState(object: any): Widget {
  const common = object?.common ?? {};
  const role = String(common.role ?? "");
  if (common.states) return "enum";
  if (common.type === "boolean" || role.includes("switch")) return "switch";
  if (common.type === "color" || role.includes("color")) return "color";
  if (
    common.type === "number" &&
    (common.min !== undefined || common.max !== undefined)
  ) {
    return "level";
  }
  return "value";
}

/** Every state id a source needs subscribed. Control sources resolve through
 *  the device registry; a device source needs none (its controls are watched). */
export function sourceStateIds(
  source: SlotSource | undefined,
  devices: EnrichedDevice[],
): string[] {
  if (!source) return [];
  if (source.kind === "state") return [source.stateId];
  if (source.kind === "device") return [];
  const device = devices.find((d) => d.id === source.device);
  const stateId = device?.controls?.find(
    (c) => c.id === source.control,
  )?.stateId;
  return stateId ? [stateId] : [];
}
