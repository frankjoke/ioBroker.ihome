import type { PluginFactory } from "../plugin-host";
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

/** The shipped `network.info` and `network.wake` plugins. */
export function createNetworkPlugins(
  wake: WakeFn = sendWake,
): Record<string, PluginFactory> {
  return {
    "network.info": (api) => ({
      async call(payload) {
        const id = deviceId(payload);
        if (id) {
          const device = api.network.get(id);
          if (!device) throw new Error(`unknown network device: ${id}`);
          return device;
        }
        return { devices: api.network.list() };
      },
    }),
    "network.wake": (api) => ({
      async call(payload) {
        const id = deviceId(payload);
        if (!id) throw new Error("network.wake needs a device id");
        const device = api.network.get(id);
        if (!device) throw new Error(`unknown network device: ${id}`);
        if (!device.mac) {
          throw new Error(`network device ${id} has no MAC`);
        }
        return wake({
          host: device.host,
          mac: device.mac,
          port: portOf(payload),
        });
      },
    }),
  };
}
