// The state pool the rule helpers see (`get("id")`, `values({role})`, …).
// With the device layer gone, the pool is built from the states the documents
// actually reference: every override's anchor and every tile source, presented
// with the override's correction. It is a read-only view over the live broker
// caches; nothing here subscribes (the page/override stores do that).
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { stateIdFor } from "$lib/config/variables";
import { applyRead } from "$lib/utils/transform";
import { getPageRegistry } from "$lib/stores/pages.svelte";
import { getOverrideRegistry } from "$lib/stores/overrides.svelte";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import { SvelteMap } from "svelte/reactivity";
import type { PoolEntry } from "$lib/config/virtual-ops";

export function getVirtualPool(): PoolEntry[] {
  const states = (ioBroker.states ?? new SvelteMap()) as Map<string, any>;
  const objects = (ioBroker.objects ?? new SvelteMap()) as Map<string, any>;
  const variables = getVariableLibrary().variables ?? [];
  const entries = new SvelteMap<string, PoolEntry>();
  const add = (stateId: string, entry: Omit<PoolEntry, "stateId">) => {
    if (!stateId.includes(".") || entries.has(stateId)) return;
    entries.set(stateId, { stateId, ...entry });
  };
  const objectOf = (stateId: string) => objects.get(stateId);

  // An override presents its state: the repair's transform and fields are what
  // a rule naming that state should see. A derived override is skipped — its
  // anchor is a different reading, and the derived value has no state id.
  for (const override of getOverrideRegistry().overrides ?? []) {
    if (override.kind !== "repair") continue;
    const stateId = stateIdFor(override.stateId, variables);
    const object = objectOf(stateId);
    add(stateId, {
      value: applyRead(states.get(stateId)?.val, override.transform),
      role: override.role ?? object?.common?.role,
      room: object?.common?.room,
      label: override.label ?? override.name ?? object?.common?.name,
      feature: override.name,
    });
  }

  // Every state a tile reads or a rule may `get()`: its raw value keeps the
  // pool helpers working even when no override presents it.
  for (const page of getPageRegistry().pages ?? []) {
    for (const group of page.groups ?? []) {
      for (const placement of group.tiles ?? []) {
        const sources = [
          ...(placement.tile?.slots ?? []).map((slot) => slot.source),
          placement.tile?.active?.source,
        ];
        for (const source of sources) {
          if (!source || typeof source === "string") continue;
          if (source.kind !== "state") continue;
          const stateId = stateIdFor(source.stateId, variables);
          const object = objectOf(stateId);
          add(stateId, {
            value: states.get(stateId)?.val,
            role: object?.common?.role,
            room: object?.common?.room,
            label: object?.common?.name ?? stateId,
          });
        }
      }
    }
  }
  return [...entries.values()];
}
