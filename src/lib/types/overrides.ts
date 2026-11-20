import type { HistorySpec, Transform } from "$lib/types/device";

/**
 * A UI-only correction attached to a state (spec §3.1): either a repair of the
 * broker object's metadata, or a derived value computed from the state's group.
 * Logic never sees it; slots and rules reference it by `id`.
 */
export interface SourceOverride {
  id: string;
  stateId: string;
  kind: "repair" | "derived";
  /** Rule name and picker label. Unique per state, case-insensitive. */
  name: string;
  /** Display label; falls back to name. */
  label?: string;
  unit?: string;
  type?: string;
  role?: string;
  states?: Record<string, string> | string[];
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  read?: boolean;
  write?: boolean;
  hideUnit?: boolean;
  transform?: Transform;
  history?: HistorySpec;
  /** kind === "derived": `$.sibling` / `get("id")` expression. */
  expr?: string;
  precision?: number;
  /** State ids the derived expression reads (`get` ids + resolved `$.` names). */
  inputs?: string[];
}

export interface OverrideRegistry {
  version: 1;
  updatedAt: number;
  /** One-time device migration marker. */
  migratedDevices?: boolean;
  overrides: SourceOverride[];
}

/** What a template apply binds after ensuring a repair: the override's id and
 *  the name the tile's rule scope will sanitize into a local. */
export interface EnsuredOverride {
  id: string;
  name: string;
}
