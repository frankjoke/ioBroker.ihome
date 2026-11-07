import type { NetworkDevice } from "./logic/network-ops";

export interface NetworkDeviceInfo {
  id: string;
  name: string;
  host: string;
  mac?: string;
}

export interface PluginApi {
  namespace: string;
  /** Read-only native config snapshot; protected secrets and plugins omitted. */
  config: Readonly<Record<string, unknown>>;
  log: {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  state: {
    get(id: string): Promise<unknown>;
    set(id: string, value: unknown, opts?: { ack?: boolean }): Promise<void>;
    getForeign(id: string): Promise<unknown>;
    setForeign(
      id: string,
      value: unknown,
      opts?: { ack?: boolean },
    ): Promise<void>;
  };
  objects: {
    get(id: string): Promise<Record<string, unknown> | undefined>;
    getForeign(id: string): Promise<Record<string, unknown> | undefined>;
  };
  network: {
    list(): NetworkDeviceInfo[];
    get(id: string): NetworkDeviceInfo | undefined;
  };
  sendTo(
    instance: string,
    command: string,
    payload?: unknown,
  ): Promise<unknown>;
}

export interface PluginApiDeps {
  namespace: string;
  config: Record<string, unknown>;
  networkDevices: NetworkDevice[];
  getState(id: string): Promise<{ val?: unknown } | null | undefined>;
  setState(id: string, value: unknown, ack: boolean): Promise<unknown>;
  getForeignState(id: string): Promise<{ val?: unknown } | null | undefined>;
  setForeignState(id: string, value: unknown, ack: boolean): Promise<unknown>;
  getObject(id: string): Promise<Record<string, unknown> | null | undefined>;
  getForeignObject(
    id: string,
  ): Promise<Record<string, unknown> | null | undefined>;
  sendTo(instance: string, command: string, payload: unknown): Promise<unknown>;
  log: {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

/** A read-only config view: no plugin code, no protected native secrets. */
export function sanitizedConfig(
  config: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const copy = structuredClone(config);
  delete copy.plugins;
  delete copy.vapidPrivateKey;
  return Object.freeze(copy);
}

function deviceInfo(device: NetworkDevice): NetworkDeviceInfo {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    ...(device.mac ? { mac: device.mac } : {}),
  };
}

export function createPluginApi(
  pluginId: string,
  deps: PluginApiDeps,
): PluginApi {
  const prefix = (message: string) => `plugin ${pluginId}: ${message}`;
  const devices = deps.networkDevices.map(deviceInfo);
  return {
    namespace: deps.namespace,
    config: sanitizedConfig(deps.config),
    log: {
      debug: (message) => deps.log.debug(prefix(message)),
      info: (message) => deps.log.info(prefix(message)),
      warn: (message) => deps.log.warn(prefix(message)),
      error: (message) => deps.log.error(prefix(message)),
    },
    state: {
      get: async (id) => (await deps.getState(id))?.val,
      set: async (id, value, opts) => {
        await deps.setState(id, value, opts?.ack === true);
      },
      getForeign: async (id) => (await deps.getForeignState(id))?.val,
      setForeign: async (id, value, opts) => {
        await deps.setForeignState(id, value, opts?.ack === true);
      },
    },
    objects: {
      get: async (id) => (await deps.getObject(id)) ?? undefined,
      getForeign: async (id) => (await deps.getForeignObject(id)) ?? undefined,
    },
    network: {
      list: () => devices.map((device) => ({ ...device })),
      get: (id) => {
        const device = devices.find((entry) => entry.id === id);
        return device ? { ...device } : undefined;
      },
    },
    sendTo: (instance, command, payload) =>
      deps.sendTo(instance, command, payload),
  };
}
