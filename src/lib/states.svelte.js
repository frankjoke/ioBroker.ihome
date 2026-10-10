// @ts-nocheck
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { getUsedStateIds } from "$lib/stores/devices";
import { SvelteSet } from "svelte/reactivity";

const loaded = new SvelteSet();
let loading = false;
let rerun = false;

// Load the current value of every *used* state into the shared StateMap.
// "Used" states are the ones referenced by the device registry plus program
// logic ids (the device list). Only these live in the state
// cache and only these are updated on stateChange. Runs once after the
// connection and again whenever the registry adds new state ids; batches yield
// to keep the UI responsive.
export async function loadUsedStates() {
  if (loading) {
    rerun = true;
    return;
  }
  loading = true;
  try {
    const pending = [...getUsedStateIds()].filter((id) => !loaded.has(id));
    for (const id of pending) loaded.add(id);
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      await Promise.all(
        batch.map((id) =>
          Promise.resolve(ioBroker.getState(id, true)).catch(() => {
            /* ignore single state failures */
          }),
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    loading = false;
  }
  if (rerun) {
    rerun = false;
    await loadUsedStates();
  }
}
