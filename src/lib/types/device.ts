import type { Size, Slot, Rule } from "$lib/types/display";

export type DeviceType =
  | "Switch"
  | "Button"
  | "Light"
  | "Thermostat"
  | "Blind"
  | "Window"
  | "AC"
  | "Thermometer"
  | "Motion"
  | "Value"
  | "Custom";

export type Widget = "switch" | "level" | "color" | "value" | "enum" | "button";

export type TransformKind = "scale" | "map" | "formula" | "jsonpath";

export type TransformStep =
  | {
      kind: "scale";
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
      clamp?: boolean;
      round?: number;
    }
  | { kind: "map"; map: Record<string, unknown> }
  | { kind: "formula"; expr: string }
  | { kind: "jsonpath"; path: string };

export interface Transform {
  read?: TransformStep;
  write?: TransformStep;
}

export interface ControlCommon {
  name?: string;
  role?: string;
  type?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  read?: boolean;
  write?: boolean;
  [key: string]: any;
}

export interface VirtualSpec {
  expr: string;
  precision?: number;
}

export interface FormulaTemplate {
  id: string;
  name: string;
  expr: string;
  precision?: number;
  unit?: string;
  notes?: string;
}

export interface FormulaLibrary {
  version: number;
  updatedAt: number;
  formulas: FormulaTemplate[];
}

export type HistoryDurationUnit = "hours" | "days";
export type HistoryAggregate =
  "average" | "min" | "max" | "total" | "count" | "none" | "onchange";

export interface HistorySpec {
  duration: number;
  durationUnit: HistoryDurationUnit;
  count?: number;
  step?: number;
  stepUnit?: "seconds" | "minutes" | "hours";
  aggregate?: HistoryAggregate;
}

/** What a control's state really is, after the control's correction beats the
 *  broker object's `common` (spec §3): one merge, read by rendering and slots. */
export interface ControlMeta {
  name?: string;
  role?: string;
  type?: string;
  states?: Record<string, string>;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  read?: boolean;
  write?: boolean;
}

export interface Control {
  id: string;
  kind?: "state" | "virtual";
  feature: string;
  stateId?: string;
  writable: boolean;
  label?: string;
  unit?: string;
  hidden?: boolean;
  transform?: Transform;
  virtual?: VirtualSpec;
  formulaId?: string;
  history?: HistorySpec;
  rules?: Rule[];
  common?: ControlCommon;
  // Corrections over the broker object (spec §3); all optional.
  role?: string;
  type?: string;
  states?: Record<string, string> | string[];
  hideUnit?: boolean;
  min?: number;
  max?: number;
  step?: number;
  read?: boolean;
  write?: boolean;
  room?: string;
  functions?: string[];
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  room?: string;
  // deprecated: superseded by page groups (spec §4.1.5) — kept so old registries still parse
  section?: string;
  // deprecated: superseded by page groups (spec §4.1.5) — kept so old registries still parse
  panel?: string;
  icon?: string;
  title?: string;
  functions?: string[];
  favorites?: string[];
  tags?: string[];
  template?: string;
  size?: Size;
  slots?: Slot[];
  watch?: string[];
  alarm?: any;
  meta?: any;
  controls: Control[];
}

export interface DeviceRegistry {
  version: number;
  updatedAt: number;
  devices: Device[];
}

export interface LiveState {
  val: any;
  ts: number;
  ack: boolean;
  lc: number;
}

export interface EnrichedControl extends Control {
  liveValue?: any;
  exists: boolean;
  available: boolean;
  displayRoom?: string;
  object?: any;
  widget?: Widget;
  virtualError?: string;
  /** The effective metadata: control correction → object → defaults. */
  meta?: ControlMeta;
}

/**
 * What a slot renderer reads off a control — also satisfied by the read-only
 * pseudo-control a raw state id resolves to (A21), so a slot can name any state
 * without owning a device control.
 */
export interface SlotControl {
  id?: string;
  stateId?: string;
  label?: string;
  unit?: string;
  role?: string;
  type?: string;
  states?: Record<string, string> | string[];
  meta?: ControlMeta;
  liveValue?: unknown;
  writable?: boolean;
  /** The control's history config (A59): what a chart reads. A raw-state
   *  pseudo-control (A21) carries none, so it cannot chart. */
  history?: HistorySpec;
}

export interface EnrichedDevice extends Device {
  displayRoom?: string;
  controls: EnrichedControl[];
  /** The device's own face (A65/A68): the document's `icon` when set — a symbol
   *  name or a path, exactly as stored — else the icon its ioBroker objects
   *  carry, already resolved to a URL. Absent when neither knows one. */
  objectIcon?: string;
}
