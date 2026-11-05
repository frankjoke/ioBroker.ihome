import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import {
  connectionStatus,
  type ConnectionStatus,
} from "$lib/connection-status";

/** `system.adapter.<namespace>.alive` — the instance's heartbeat. */
export function aliveId(): string {
  return `system.adapter.${ioBroker.namespace}.alive`;
}

export function adapterAlive(): boolean | undefined {
  const state = ioBroker.states.get(aliveId());
  return state ? state.val === true : undefined;
}

export function connectionState(): ConnectionStatus {
  return connectionStatus(!!ioBroker.connected, adapterAlive());
}

/** Add the heartbeat to the used-state set so it stays subscribed. */
export function registerAliveState(): void {
  registerProgramStateId(aliveId());
}
