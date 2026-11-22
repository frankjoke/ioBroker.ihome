import { normalizeStates } from "./state-meta";
import type { SourceOverride } from "$lib/types/overrides";

/**
 * The value labels a state editor starts with: a repair follows the state's
 * own `common.states` unless it stored its own map. A derived override has no
 * value labels.
 */
export function statesForOverride(
  override: SourceOverride | undefined,
  common: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (override?.kind === "derived") return undefined;
  if (override?.states !== undefined) return normalizeStates(override.states);
  return normalizeStates(common?.states);
}
