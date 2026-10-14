import type { Size, Slot, Rule } from "$lib/types/display";

export type DeviceType =
  | "Switch"
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
}

export interface EnrichedDevice extends Device {
  displayRoom?: string;
  controls: EnrichedControl[];
}
