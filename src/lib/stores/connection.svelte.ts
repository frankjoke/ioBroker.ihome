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

/** True when the socket resolved to the local broker (not the cloud). */
export function isLocalBroker(): boolean {
  const url = ioBroker.brokerUrl;
  if (!url) return false;
  const match = /^(?:https?|wss?):\/\/([^/:?#]+)/i.exec(url);
  if (!match) return false;
  const host = match[1].toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
