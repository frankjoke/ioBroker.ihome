import { execFile } from "node:child_process";
import net from "node:net";
import {
  initialPresence,
  nextPresence,
  presenceFromJson,
  presenceJsonValue,
  type NetworkDevice,
  type NetworkPresence,
} from "./logic/network-ops";

/** The adapter surface the presence service needs (keeps tests adapter-free). */
export interface NetworkAdapter {
  namespace: string;
  log: {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<unknown>;
  setStateAsync(id: string, state: ioBroker.SettableState): Promise<unknown>;
  getStateAsync(id: string): Promise<ioBroker.State | null | undefined>;
}

export type NetworkProbe = (device: NetworkDevice) => Promise<boolean>;

const PING_TIMEOUT_PAD_MS = 500;

export interface PingCommand {
  file: string;
  args: string[];
}

export type PingRunner = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<boolean>;

/** The platform and address-family specific ping invocation. */
export function pingCommand(
  host: string,
  timeoutMs: number,
  platform: typeof process.platform = process.platform,
): PingCommand {
  const v6 = net.isIP(host) === 6;
  if (platform === "win32") {
    return {
      file: "ping",
      args: [...(v6 ? ["-6"] : []), "-n", "1", "-w", String(timeoutMs), host],
    };
  }
  if (platform === "darwin") {
    return {
      file: v6 ? "ping6" : "ping",
      args: ["-c", "1", "-W", String(timeoutMs), host],
    };
  }
  return {
    file: "ping",
    args: [
      ...(v6 ? ["-6"] : []),
      "-c",
      "1",
      "-W",
      String(Math.ceil(timeoutMs / 1000)),
      host,
    ],
  };
}

const defaultPingRunner: PingRunner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs + PING_TIMEOUT_PAD_MS, windowsHide: true },
      (error) => resolve(!error),
    );
  });

/** A single ping; true only on exit code 0. */
export function probePing(
  host: string,
  timeoutMs: number,
  run: PingRunner = defaultPingRunner,
): Promise<boolean> {
  const { file, args } = pingCommand(host, timeoutMs);
  return run(file, args, timeoutMs);
}

/** A TCP presence probe.
 *  Open port = reachable; a refused connection also proves the host is up
 *  (Android answers a closed port with RST), so both count as online. */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (online: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(online);
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", (error) =>
      finish((error as { code?: string }).code === "ECONNREFUSED"),
    );
  });
}

/** Ping by default; a configured TCP port wins. */
export function probeDevice(device: NetworkDevice): Promise<boolean> {
  const timeoutMs = device.timeout * 1000;
  return device.port > 0
    ? probeTcp(device.host, device.port, timeoutMs)
    : probePing(device.host, timeoutMs);
}

/** Polls configured devices and keeps one JSON + individual states per device. */
export class NetworkPresenceService {
  private readonly presences = new Map<string, NetworkPresence>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly checking = new Set<string>();

  constructor(
    private readonly adapter: NetworkAdapter,
    private readonly devices: NetworkDevice[],
    private readonly probe: NetworkProbe = probeDevice,
    private readonly now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {
    for (const device of this.devices) {
      try {
        await this.ensureStates(device);
        this.presences.set(device.id, await this.readPresence(device));
        this.timers.set(
          device.id,
          setInterval(() => void this.check(device), device.interval * 1000),
        );
        void this.check(device);
      } catch (e) {
        this.adapter.log.warn(
          `network ${device.id}: could not start: ${message(e)}`,
        );
      }
    }
    if (this.devices.length > 0) {
      this.adapter.log.info(
        `Network presence: ${this.devices.length} device(s)`,
      );
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.presences.clear();
    this.checking.clear();
  }

  /** One probe + state write; exposed for tests. */
  async check(device: NetworkDevice): Promise<void> {
    if (this.checking.has(device.id)) return;
    this.checking.add(device.id);
    try {
      const online = await this.probe(device).catch((e) => {
        this.adapter.log.debug(
          `network ${device.id}: probe failed: ${message(e)}`,
        );
        return false;
      });
      const previous = this.presences.get(device.id) ?? initialPresence();
      const next = nextPresence(previous, online, this.now());
      this.presences.set(device.id, next);
      if (previous.online !== next.online || previous.status !== next.status) {
        this.adapter.log.debug(`network ${device.id}: ${next.status}`);
      }
      await this.writePresence(device, previous, next);
    } finally {
      this.checking.delete(device.id);
    }
  }

  private async ensureStates(device: NetworkDevice): Promise<void> {
    await this.adapter.setObjectNotExistsAsync("network", {
      _id: "network",
      type: "folder",
      common: { name: "Network presence" },
      native: {},
    });
    await this.adapter.setObjectNotExistsAsync(`network.${device.id}`, {
      _id: `network.${device.id}`,
      type: "folder",
      common: { name: device.name },
      native: {},
    });
    const states: Array<{
      field: string;
      name: string;
      type: "string" | "boolean" | "number";
      role: string;
      def: string | boolean | number;
    }> = [
      {
        field: "json",
        name: "Presence (JSON)",
        type: "string",
        role: "text.json",
        def: "{}",
      },
      {
        field: "online",
        name: "Online",
        type: "boolean",
        role: "indicator.state",
        def: false,
      },
      {
        field: "status",
        name: "Status",
        type: "string",
        role: "text",
        def: "unknown",
      },
      {
        field: "lastConnected",
        name: "Last connected",
        type: "number",
        role: "value.time",
        def: 0,
      },
      {
        field: "lastDisconnected",
        name: "Last disconnected",
        type: "number",
        role: "value.time",
        def: 0,
      },
      {
        field: "lastSeen",
        name: "Last seen",
        type: "number",
        role: "value.time",
        def: 0,
      },
      {
        field: "name",
        name: "Name",
        type: "string",
        role: "text",
        def: device.name,
      },
      {
        field: "host",
        name: "Host",
        type: "string",
        role: "text",
        def: device.host,
      },
    ];
    for (const state of states) {
      await this.adapter.setObjectNotExistsAsync(
        `network.${device.id}.${state.field}`,
        {
          _id: `network.${device.id}.${state.field}`,
          type: "state",
          common: {
            name: state.name,
            type: state.type,
            role: state.role,
            read: true,
            write: false,
            def: state.def,
          },
          native: {},
        },
      );
    }
    await this.adapter.setStateAsync(`network.${device.id}.name`, {
      val: device.name,
      ack: true,
    });
    await this.adapter.setStateAsync(`network.${device.id}.host`, {
      val: device.host,
      ack: true,
    });
  }

  private async readPresence(device: NetworkDevice): Promise<NetworkPresence> {
    const state = await this.adapter.getStateAsync(`network.${device.id}.json`);
    return presenceFromJson(state?.val) ?? initialPresence();
  }

  private async writePresence(
    device: NetworkDevice,
    previous: NetworkPresence,
    next: NetworkPresence,
  ): Promise<void> {
    const base = `network.${device.id}`;
    const writes: Array<[string, ioBroker.SettableState]> = [];
    if (previous.online !== next.online) {
      writes.push([`${base}.online`, { val: next.online, ack: true }]);
    }
    if (previous.status !== next.status) {
      writes.push([`${base}.status`, { val: next.status, ack: true }]);
    }
    if (previous.lastConnected !== next.lastConnected) {
      writes.push([
        `${base}.lastConnected`,
        { val: next.lastConnected, ack: true },
      ]);
    }
    if (previous.lastDisconnected !== next.lastDisconnected) {
      writes.push([
        `${base}.lastDisconnected`,
        { val: next.lastDisconnected, ack: true },
      ]);
    }
    if (previous.lastSeen !== next.lastSeen) {
      writes.push([`${base}.lastSeen`, { val: next.lastSeen, ack: true }]);
    }
    for (const [id, state] of writes) {
      await this.adapter.setStateAsync(id, state);
    }
    await this.adapter.setStateAsync(`${base}.json`, {
      val: JSON.stringify(presenceJsonValue(next)),
      ack: true,
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
