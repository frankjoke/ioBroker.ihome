export type ConnectionStatus = "ok" | "warning" | "error" | "pending";

/** The cog: error when the broker is unreachable, warning when the UI is
 *  connected but the adapter instance is not alive, green only for both. */
export function connectionStatus(
  connected: boolean,
  adapterAlive: boolean | undefined,
): ConnectionStatus {
  if (!connected) return "error";
  if (adapterAlive === true) return "ok";
  if (adapterAlive === false) return "warning";
  return "pending";
}
