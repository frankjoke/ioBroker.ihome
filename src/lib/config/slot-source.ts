import type {
  Control,
  ControlMeta,
  EnrichedControl,
  EnrichedDevice,
  HistorySpec,
  Transform,
  Widget,
} from "$lib/types/device";
import type { SlotSource } from "$lib/types/display";
import type { SourceOverride } from "$lib/types/overrides";
import {
  convertValue,
  stateIdFor,
  type GlobalVariable,
} from "$lib/config/variables";
import { applyRead } from "$lib/utils/transform";
import { effectiveCommon, widgetForMeta } from "$lib/config/state-meta";

/** What the resolver reads: the enriched devices, the broker caches and the
 *  source overrides a raw state can bind to. */
export interface SourceLook {
  devices: EnrichedDevice[];
  states: Map<string, any>;
  objects: Map<string, any>;
  /** A raw-state source may name a variable; the library maps it to its state. */
  variables?: GlobalVariable[];
  /** The overrides a state source names (absent → none loaded). */
  overrides?: SourceOverride[];
  /** A derived override's live value; the store is the authority on these. */
  derived?: (id: string) => { value?: unknown; error?: string };
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
  /** The effective metadata after an override's correction. */
  meta?: ControlMeta;
  /** The override the source is bound to, when it resolved. */
  overrideId?: string;
  /** Why the override could not apply, or its derived expression error. */
  error?: string;
  /** The chart feed a repair override supplies. */
  history?: HistorySpec;
  /** The bound repair's transform: the read step already shaped `value`, the
   *  write step belongs to the state, so writes go through it too. */
  transform?: Transform;
}

const NO_CONTROL = { id: "", feature: "", writable: false } as Control;

/** A repair override's fields as the correction `effectiveCommon` merges. */
function correction(override: SourceOverride): Control {
  return {
    id: "",
    feature: "",
    writable: false,
    unit: override.unit,
    type: override.type,
    role: override.role,
    states: override.states,
    min: override.min,
    max: override.max,
    step: override.step,
    read: override.read,
    write: override.write,
    hideUnit: override.hideUnit,
  };
}

/** What an override corrects on a resolved source. */
function presented(
  meta: ControlMeta,
  override: SourceOverride,
): Partial<ResolvedSource> {
  return {
    widget: widgetForMeta(meta),
    unit: meta.unit,
    label: override.label ?? override.name ?? meta.name,
    role: meta.role,
    type: meta.type,
    states: meta.states,
    meta,
  };
}

/** A repair declares the state's real scalar type; the broker may still send
 *  text ("12" for a number). Undeclared or unparseable values pass through. */
function declaredValue(value: unknown, type: string | undefined): unknown {
  if (type !== "number" && type !== "boolean") return value;
  const { value: out, error } = convertValue(String(value), type);
  return error ? value : out;
}

/**
 * The one way a slot reads: a device control (live, through the device's
 * transform/virtual layer), a raw state — through an override when one is
 * bound — or a device (badges). Absent source or a missing device/control →
 * unavailable, never a throw.
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
      meta: control.meta,
    };
  }
  if (source.kind === "state") {
    const stateId = stateIdFor(source.stateId, look.variables ?? []);
    const object = look.objects.get(stateId);
    const state = look.states.get(stateId);
    const meta = effectiveCommon(NO_CONTROL, object);
    const base: ResolvedSource = {
      value: state?.val,
      writable: object?.common?.write === true,
      available: !!object || state !== undefined,
      stateId,
      object,
      widget: widgetForMeta(meta),
      unit: meta.unit,
      label: meta.name,
      role: meta.role,
      type: meta.type,
      states: meta.states,
      meta,
    };
    const wanted = source.override;
    if (!wanted) return base;

    const override = (look.overrides ?? []).find((o) => o.id === wanted);
    if (
      override &&
      stateIdFor(override.stateId, look.variables ?? []) !== stateId
    ) {
      return {
        ...base,
        error: `override "${wanted}" belongs to "${override.stateId}", not "${stateId}"`,
      };
    }
    if (override?.kind === "repair") {
      const corrected = presented(
        effectiveCommon(correction(override), object),
        override,
      );
      return {
        ...base,
        ...corrected,
        value: declaredValue(
          applyRead(state?.val, override.transform),
          corrected.type,
        ),
        writable: override.write ?? base.writable,
        overrideId: override.id,
        history: override.history,
        transform: override.transform,
      };
    }
    // A derived override resolves through the evaluator; the registry entry,
    // when the caller passes one, adds its presentation and its anchor guard.
    const result = look.derived?.(wanted);
    if (override) {
      return {
        ...base,
        ...presented(effectiveCommon(correction(override)), override),
        value: result?.error ? undefined : result?.value,
        writable: false,
        available: !!result && !result.error,
        overrideId: override.id,
        error:
          result?.error ??
          (result
            ? undefined
            : `derived override "${wanted}" cannot be evaluated`),
      };
    }
    // The id is gone from the registry: raw state plus the store's answer.
    if (result && !result.error) {
      return {
        ...base,
        value: result.value,
        writable: false,
        available: true,
        overrideId: wanted,
      };
    }
    return { ...base, error: `unknown override "${wanted}"` };
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
  return widgetForMeta(effectiveCommon(NO_CONTROL, object));
}

/** What a source picker chip dedupes by: a state's override is part of the
 *  source, so a raw state, a repair and a derived stay three distinct chips. */
export function sourceChipKey(
  source: SlotSource | string,
  stateId?: string,
): string {
  if (typeof source === "string") return stateId ?? source;
  if (source.kind === "state") {
    return `${stateId ?? source.stateId}:override:${source.override ?? ""}`;
  }
  if (source.kind === "control") {
    return `${stateId ?? ""}:control:${source.device}:${source.control}`;
  }
  return `device:${source.device}`;
}

/** Every state id a source needs subscribed. Control sources resolve through
 *  the device registry; a device source needs none (its controls are watched),
 *  and a derived override subscribes the inputs it reads. */
export function sourceStateIds(
  source: SlotSource | undefined,
  devices: EnrichedDevice[],
  variables: GlobalVariable[] = [],
  overrides: SourceOverride[] = [],
): string[] {
  if (!source) return [];
  if (source.kind === "state") {
    const stateId = stateIdFor(source.stateId, variables);
    const override = source.override
      ? overrides.find((o) => o.id === source.override)
      : undefined;
    const bound =
      !!override && stateIdFor(override.stateId, variables) === stateId;
    const inputs = bound
      ? (override.inputs ?? []).map((id) => stateIdFor(id, variables))
      : [];
    return [...new Set([stateId, ...inputs])];
  }
  if (source.kind === "device") return [];
  const device = devices.find((d) => d.id === source.device);
  const stateId = device?.controls?.find(
    (c) => c.id === source.control,
  )?.stateId;
  return stateId ? [stateId] : [];
}
