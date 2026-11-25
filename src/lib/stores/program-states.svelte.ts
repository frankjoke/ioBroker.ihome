// The state ids the program uses beyond the pages/overrides themselves:
// documents (settings, variables, templates, …), formula/function library ids
// and state ids a runtime piece (HTML bridge, placeholders) reads. They are
// subscribed and kept live by the connection layer through this one set.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { configId } from "$lib/config/config-id";

/** The legacy device document: still read by the one-time migration runner. */
export const deviceListId = () => configId("deviceList", ioBroker.namespace);

// A plain Set on purpose: mutations must not each trigger a recompute —
// `programVersion` below is the one reactive signal the connection watches.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const PROGRAM_STATE_IDS = new Set<string>();

/** Bumped whenever the program (layouts, overrides, variables) changed, so
 *  `getUsedStateIds` recomputes. `$state` on purpose: the connection layer
 *  watches the used set to (re)subscribe. */
let programVersion = $state(0);

export function registerProgramStateId(id: string) {
  if (!id || PROGRAM_STATE_IDS.has(id)) return;
  PROGRAM_STATE_IDS.add(id);
  programVersion++;
}

/** The version the used-state cache keys on. */
export function programStateVersion(): number {
  return programVersion;
}

/** Every id registered directly, plus the current instance's device document. */
export function programStateIds(): Set<string> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const ids = new Set(PROGRAM_STATE_IDS);
  ids.add(deviceListId());
  return ids;
}
