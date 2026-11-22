import type { PluginFactory } from "../plugin-host";
import type { PluginApi } from "../plugin-api";
import { discoverMac } from "../network-mac";
import { sendWake, type WakeOptions } from "../wake-on-lan";

/** What the plugin factory injects; tests replace the UDP sender. */
export type WakeFn = (options: WakeOptions) => Promise<unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deviceId(payload: unknown): string {
  if (!record(payload)) return "";
  return typeof payload.id === "string" ? payload.id.trim() : "";
}

function portOf(payload: unknown): number | undefined {
  if (!record(payload)) return undefined;
  return typeof payload.port === "number" && Number.isFinite(payload.port)
    ? payload.port
    : undefined;
}

function textOf(payload: unknown, key: string): string | undefined {
  if (!record(payload)) return undefined;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timeoutOf(payload: unknown): number | undefined {
  if (!record(payload)) return undefined;
  return typeof payload.timeout === "number" && Number.isFinite(payload.timeout)
    ? payload.timeout
    : undefined;
}

/** Wake a tracked device (id) or a direct MAC payload. */
async function wakePayload(
  api: PluginApi,
  wake: WakeFn,
  findMac: (host: string) => Promise<string | undefined>,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const id = deviceId(payload);
  if (id) {
    const device = api.network.get(id);
    if (!device) throw new Error(`unknown network device: ${id}`);
    const mac = device.mac ?? (await findMac(device.host));
    if (!mac) {
      throw new Error(
        `network device ${id} has no MAC and the neighbour table has no entry`,
      );
    }
    return wake({
      host: device.host,
      mac,
      port: portOf(payload),
    });
  }
  const mac = textOf(payload, "mac");
  if (!mac) {
    throw new Error("network.info wake needs a network device id or a MAC");
  }
  const broadcast = textOf(payload, "broadcast");
  const timeout = timeoutOf(payload);
  return wake({
    host: textOf(payload, "ip") ?? textOf(payload, "host") ?? "255.255.255.255",
    mac,
    port: portOf(payload),
    ...(broadcast ? { broadcast } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  });
}

/** The shipped `network.info` plugin: device info and Wake-on-LAN. */
export function createNetworkPlugins(
  wake: WakeFn = sendWake,
  findMac: (host: string) => Promise<string | undefined> = discoverMac,
): Record<string, PluginFactory> {
  return {
    "network.info": (api) => ({
      async call(payload) {
        if (
          record(payload) &&
          (payload.wake === true || payload.action === "wake")
        ) {
          return wakePayload(api, wake, findMac, payload);
        }
        const id = deviceId(payload);
        if (id) {
          const device = api.network.get(id);
          if (!device) throw new Error(`unknown network device: ${id}`);
          return device;
        }
        return { devices: api.network.list() };
      },
    }),
  };
}
