// The legacy device document (ihome.0.config.deviceList). The display no longer
// reads it: the one-time migration (`device-migration.svelte.ts`) converts it
// into source overrides, and until that marker is set an un-migrated
// installation still needs its state ids subscribed, so this store keeps the
// document and contributes them to `getUsedStateIds`.
import type { DeviceRegistry } from "$lib/types/device";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import { stateIdFor } from "$lib/config/variables";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import {
  programStateIds,
  programStateVersion,
} from "$lib/stores/program-states.svelte";
import { SvelteSet } from "svelte/reactivity";

export { DEVICE_LIST_ID } from "$lib/stores/program-states.svelte";

const defaultRegistry: DeviceRegistry = {
  version: 0,
  updatedAt: Date.now(),
  devices: [],
};

let canonicalRegistry = $state<DeviceRegistry>(defaultRegistry);
export function getCanonicalRegistry() {
  return canonicalRegistry;
}
export function setCanonicalRegistry(reg: DeviceRegistry) {
  canonicalRegistry = reg;
}

// ------------------------------------------------------------- used state ids
let usedStateCache: {
  reg: DeviceRegistry | null;
  ver: number;
  /** The variable library's version: a re-pointed variable re-subscribes. */
  lib: number;
  ids: Set<string>;
} = {
  reg: null,
  ver: -1,
  lib: -1,
  ids: new SvelteSet(),
};

// Raw state ids an expression reads with the pool helper (`get("id")`) have to
// be subscribed before they are read — the scanner lives in rule-ops (shared
// with the pages and formula stores) and an id it misses degrades to "that rule
// never matches" (spec §14), never to a crash.
function addExpressionStateIds(
  expr: string | undefined,
  into: Set<string>,
): void {
  for (const id of stateIdsInExpression(expr ?? "")) into.add(id);
}

function addRuleStateIds(
  rules: { when?: string }[] | undefined,
  into: Set<string>,
): void {
  for (const rule of rules ?? []) addExpressionStateIds(rule?.when, into);
}

/**
 * Every state the program uses: the registered program ids plus the legacy
 * document's controls, watches and rules while an un-migrated installation
 * still references them. A migrated installation contributes nothing here.
 */
export function getUsedStateIds(): Set<string> {
  const lib = getVariableLibrary().version ?? 0;
  const ver = programStateVersion();
  if (
    usedStateCache.reg === canonicalRegistry &&
    usedStateCache.ver === ver &&
    usedStateCache.lib === lib
  ) {
    return usedStateCache.ids;
  }
  const variables = getVariableLibrary().variables ?? [];
  const ids = new SvelteSet<string>(programStateIds());
  const stateIdOf = (ref: string | undefined): string | undefined =>
    ref ? stateIdFor(ref, variables) : undefined;
  for (const device of canonicalRegistry.devices ?? []) {
    for (const id of device.watch ?? []) ids.add(id);
    for (const slot of device.slots ?? []) {
      const source =
        typeof slot?.source === "string"
          ? stateIdOf(slot.source)
          : slot?.source?.kind === "state"
            ? stateIdOf(slot.source.stateId)
            : undefined;
      if (source && source.includes(".")) ids.add(source);
      addRuleStateIds(slot?.rules, ids);
    }
    for (const control of device.controls ?? []) {
      const id = stateIdOf(control.stateId);
      if (id && id.includes(".")) ids.add(id);
      addExpressionStateIds(control.virtual?.expr, ids);
      addRuleStateIds(control.rules, ids);
    }
  }
  usedStateCache = { reg: canonicalRegistry, ver, lib, ids };
  return ids;
}
