import type { DeviceItem, LogicDef } from "$logic/types";
import type { FeatureDef } from "$lib/config/features";
import type { DeviceType } from "$lib/types/device";
import type { Background, Size, Slot } from "$lib/types/display";

export interface TemplateParameter {
  name: string;
  label: string;
  type: "string" | "state" | "memory" | "number" | "boolean" | "duration";
  default?: string | number | boolean;
  description?: string;
}

/** Reuses the API item model, but conversion fields are code strings so the
 *  bundle stays JSON-safe; the apply compiles them. */
export type TemplateItem = Omit<DeviceItem, "conversion" | "setConversion"> & {
  conversion?: string;
  setConversion?: string;
};

export interface TemplateDevicePart {
  type: DeviceType;
  size?: Size;
  background?: Background;
  features: FeatureDef[];
  slots: Slot[];
}

export interface TemplateLogicPart {
  /** May contain {{param}} placeholders. */
  logic: LogicDef;
}

export interface TemplateApiPart {
  /** JS source evaluated to the read/write shape; shared items/params win. */
  source: string;
}

export interface TemplateBundle {
  id: string;
  name: string;
  description?: string;
  params?: TemplateParameter[];
  /** Shared state/item definitions. */
  items?: TemplateItem[];
  device?: TemplateDevicePart;
  logic?: TemplateLogicPart;
  api?: TemplateApiPart;
}

export interface TemplateBundleLibrary {
  version: number;
  updatedAt: number;
  bundles: TemplateBundle[];
}
