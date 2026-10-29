import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { getVariables, upsertVariable } from "$lib/stores/variables.svelte";
import { registerProgramStateId } from "$lib/stores/devices.svelte.js";
import { saveVariables } from "$lib/variables.svelte.js";
import type { GlobalVariable } from "$lib/config/variables";

function findVariable(name: string): GlobalVariable | undefined {
  return getVariables().find((v) => v.name === name);
}

/**
 * The API an html slot's document gets as `ihome.*` (and the bare helpers).
 * It lives in the parent page; the frame reaches it through the same-origin
 * boundary. The document is trusted editor content, so it may write states and
 * variables; the broker's ACL still applies to the state writes.
 */
export const htmlBridge = {
  /** Write a state (ack=false), subscribing it for any later reads. */
  async setState(id: string, value: unknown) {
    registerProgramStateId(id);
    return ioBroker.setState(id, value);
  },

  /** Read a state fresh from the broker. */
  async getState(id: string) {
    registerProgramStateId(id);
    const state = await ioBroker.getState(id, true);
    return state?.val;
  },

  async toggle(id: string) {
    const value = await htmlBridge.getState(id);
    return htmlBridge.setState(id, !value);
  },

  /** A constant's text, or a state variable's live value. */
  async getVariable(name: string) {
    const variable = findVariable(name);
    if (!variable) return undefined;
    if (variable.kind === "state" && variable.stateId) {
      return htmlBridge.getState(variable.stateId);
    }
    return variable.value;
  },

  /** A state variable writes its state; a constant updates the library. */
  async setVariable(name: string, value: unknown) {
    const variable = findVariable(name);
    if (!variable) return false;
    if (variable.kind === "state" && variable.stateId) {
      await htmlBridge.setState(variable.stateId, value);
      return true;
    }
    upsertVariable({ ...variable, value: String(value) });
    saveVariables();
    return true;
  },
};

/** Install the parent side once; every html slot's bridge script uses it. */
export function installHtmlBridge(): void {
  (globalThis as unknown as { __IHOME__: typeof htmlBridge }).__IHOME__ =
    htmlBridge;
}
