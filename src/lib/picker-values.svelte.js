// @ts-nocheck
// On-demand current values for the StatePicker. Deliberately does NOT touch the
// live state cache (only used states live there): it fetches raw states over the
// socket via emitAsync("getState") — NOT ioBroker.getState(), which would insert
// the id into the shared StateMap — and keeps its own small value map.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

const values = new SvelteMap();
const fetched = new SvelteSet();

/** Current value + timestamp for an id, if found. */
export function getPickerValue(id) {
  return values.get(id);
}

/** Whether a fetch for this id has completed (found or not). */
export function isPickerFetched(id) {
  return fetched.has(id);
}

/** Fetch current values for the given ids (parallel, failures skipped). */
export async function fetchPickerValues(ids) {
  const unique = [...new SvelteSet(ids)];
  await Promise.all(
    unique.map((id) =>
      Promise.resolve(ioBroker.emitAsync("getState", id))
        .then((st) => {
          if (st) values.set(id, { val: st.val, ts: st.ts });
        })
        .catch(() => {
          /* ignore a single failing id so the batch still resolves */
        })
        .finally(() => fetched.add(id)),
    ),
  );
}
