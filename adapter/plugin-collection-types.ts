// Browser-safe collection types: the SPA imports these, so this module must
// never pull the adapter's logic runtime.
import type { LogicDef } from "./logic/types";

export interface PluginStateDecl {
  id: string;
  type: "state" | "folder";
  common: Record<string, unknown>;
  /** Copied without native.ihomeCollection. */
  native?: Record<string, unknown>;
}

export interface PluginCollection {
  version: 1;
  states: PluginStateDecl[];
  logics: LogicDef[];
  /** External state ids the collection needs but does not own. */
  uses?: string[];
}

export type CollectionConflict = {
  kind: "state" | "logic";
  id: string;
  reason: "conflict" | "foreign";
};

export interface CaptureRequest {
  id: string;
  name: string;
  version: string;
  logicIds: string[];
  stateIds: string[];
  tiles: unknown[];
}
