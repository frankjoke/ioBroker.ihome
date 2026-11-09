import dgram from "node:dgram";
import { isIP } from "node:net";

export interface WakeOptions {
  host: string;
  mac: string;
  port?: number;
  /** Directed broadcast; defaults to the host's /24 broadcast. */
  broadcast?: string;
  /** UDP send timeout in ms. */
  timeout?: number;
}

export type WakeSender = (
  packet: Buffer,
  port: number,
  targets: string[],
  timeoutMs: number,
) => Promise<void>;

const DEFAULT_PORT = 9;
const DEFAULT_SEND_TIMEOUT_MS = 2000;
const MIN_SEND_TIMEOUT_MS = 100;
const MAX_SEND_TIMEOUT_MS = 10_000;

function timeoutOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SEND_TIMEOUT_MS;
  }
  return Math.min(
    MAX_SEND_TIMEOUT_MS,
    Math.max(MIN_SEND_TIMEOUT_MS, Math.round(value)),
  );
}

function clampPort(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PORT;
  return Math.min(65_535, Math.max(1, Math.round(number)));
}

/** 6 × 0xff followed by the MAC 16 times (102 bytes), per the WoL spec. */
export function magicPacket(mac: string): Buffer {
  const bytes = mac.split(/[:-]/).map((part) => Number.parseInt(part, 16));
  if (
    bytes.length !== 6 ||
    bytes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    throw new Error(`invalid MAC: ${mac}`);
  }
  return Buffer.concat([
    Buffer.alloc(6, 0xff),
    Buffer.concat(Array.from({ length: 16 }, () => Buffer.from(bytes))),
  ]);
}

/** The `/24` broadcast of an IPv4 address. */
export function broadcastOf(host: string): string {
  return host.replace(/\.\d+$/, ".255");
}

/** Both the broadcast (directed or limited) and the host itself. */
export function wakeTargets(host: string, broadcast?: string): string[] {
  if (broadcast !== undefined) {
    if (isIP(broadcast) !== 4) {
      throw new Error("Wake-on-LAN needs an IPv4 broadcast");
    }
    const targets = [broadcast];
    if (isIP(host) === 4 && host !== broadcast) targets.push(host);
    return targets;
  }
  const family = isIP(host);
  if (family === 6) {
    throw new Error("Wake-on-LAN needs an IPv4 host");
  }
  return family === 4 ? [broadcastOf(host), host] : ["255.255.255.255", host];
}

const defaultWakeSender: WakeSender = (packet, port, targets, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("Wake-on-LAN send timed out"));
    }, timeoutMs);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed by a previous error
      }
      if (error) reject(error);
      else resolve();
    };

    socket.once("error", finish);
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let pending = targets.length;
      for (const target of targets) {
        socket.send(packet, port, target, (error) => {
          if (error) {
            finish(error);
            return;
          }
          if (--pending === 0) finish();
        });
      }
    });
  });

/** Send the magic packet; the sender is injectable for tests. */
export async function sendWake(
  options: WakeOptions,
  send: WakeSender = defaultWakeSender,
): Promise<{ host: string; port: number; targets: string[] }> {
  const port = clampPort(options.port);
  const targets = wakeTargets(options.host, options.broadcast);
  await send(
    magicPacket(options.mac),
    port,
    targets,
    timeoutOf(options.timeout),
  );
  return { host: options.host, port, targets };
}
