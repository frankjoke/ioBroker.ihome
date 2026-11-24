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
  /** `modified`: this plugin's own item was edited locally; it is kept and
   *  skipped until a restore/overwrite.
   *  `unmanaged`: an ordinary user item exists; overwrite may claim it.
   *  `foreign`: another plugin owns it; overwrite is refused. */
  reason: "modified" | "unmanaged" | "foreign";
};

export interface CaptureRequest {
  id: string;
  name: string;
  version: string;
  logicIds: string[];
  stateIds: string[];
  tiles: unknown[];
}
