import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { pingCommand } from "./network-presence";

/** Runs one neighbour-table command and returns its stdout. */
export type MacCommand = (file: string, args: string[]) => Promise<string>;

const runCommand: MacCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 3000, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });

const MAC = /([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/;

/** The first usable MAC in an `ip neigh` / `arp` line. */
export function macFromOutput(output: string): string | undefined {
  const found = MAC.exec(output);
  if (!found) return undefined;
  const mac = found[0].replace(/-/g, ":").toLowerCase();
  if (mac === "00:00:00:00:00:00" || mac === "ff:ff:ff:ff:ff:ff") {
    return undefined;
  }
  return mac;
}

/** The MAC the local neighbour table knows for an IP address. */
export async function neighborMac(
  ip: string,
  platform: string = process.platform,
  run: MacCommand = runCommand,
): Promise<string | undefined> {
  const file = platform === "win32" || platform === "darwin" ? "arp" : "ip";
  const args =
    platform === "win32"
      ? ["-a", ip]
      : platform === "darwin"
        ? ["-n", ip]
        : ["neigh", "show", ip];
  try {
    return macFromOutput(await run(file, args));
  } catch {
    return undefined;
  }
}

async function resolveIp(host: string): Promise<string | undefined> {
  if (isIP(host)) return host;
  try {
    return (await dns.lookup(host, { family: 4 })).address;
  } catch {
    try {
      return (await dns.lookup(host)).address;
    } catch {
      return undefined;
    }
  }
}

async function ping(host: string): Promise<void> {
  const command = pingCommand(host, 1000);
  await new Promise<void>((resolve) => {
    execFile(
      command.file,
      command.args,
      { timeout: 1500, windowsHide: true },
      () => resolve(),
    );
  });
}

/**
 * Resolve a hostname or address to the MAC in the local neighbour table.
 * A device that is off and no longer cached has no entry: WoL then needs the
 * MAC entered once.
 */
export async function discoverMac(
  host: string,
  options: {
    platform?: string;
    run?: MacCommand;
    probeHost?: (host: string) => Promise<void>;
  } = {},
): Promise<string | undefined> {
  const ip = await resolveIp(host);
  if (!ip) return undefined;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  const cached = await neighborMac(ip, platform, run);
  if (cached) return cached;
  await (options.probeHost ?? ping)(host);
  return neighborMac(ip, platform, run);
}
