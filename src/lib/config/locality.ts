/** Session classification for external-access policy.
 *
 *  The class is a visibility layer, not an authorisation boundary
 *  (App-structure 3.8, secured.ts). The boundary is the access layer:
 *  VPN, reverse-proxy auth, or web.0 auth. */

export interface ExternalSessionSettings {
  localHosts: string[];
  externalHosts: string[];
  forceExternal: boolean;
}

export type SessionReason =
  | "force-external"
  | "explicit-local"
  | "explicit-external"
  | "private-host"
  | "https"
  | "public-http"
  | "no-location";

export interface SessionClass {
  external: boolean;
  reason: SessionReason;
}

export const MAX_SESSION_HOSTS = 100;
const MAX_HOST_LENGTH = 253;

/** Trim, lowercase, drop a trailing dot, a port, and IPv6 brackets. */
export function normalizeHost(value: string): string {
  let host = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end > 0 ? host.slice(1, end) : host;
  } else if (/^[^:]+:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }
  return host.replace(/\.+$/, "");
}

function cleanHosts(values: readonly unknown[]): string[] {
  const hosts: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const host = normalizeHost(value);
    if (!host || host.length > MAX_HOST_LENGTH) continue;
    if (hosts.includes(host)) continue;
    hosts.push(host);
    if (hosts.length >= MAX_SESSION_HOSTS) break;
  }
  return hosts;
}

/** Host text from the settings card: one host per line. */
export function parseHostList(text: string): string[] {
  return cleanHosts(String(text ?? "").split("\n"));
}

/** Lenient read of `settings.externalSession`; junk becomes the defaults. */
export function externalSessionSettings(raw: unknown): ExternalSessionSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { localHosts: [], externalHosts: [], forceExternal: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    localHosts: cleanHosts(
      Array.isArray(record.localHosts) ? record.localHosts : [],
    ),
    externalHosts: cleanHosts(
      Array.isArray(record.externalHosts) ? record.externalHosts : [],
    ),
    forceExternal: record.forceExternal === true,
  };
}

/** localhost, mDNS, RFC1918, IPv4 link-local, IPv6 loopback/ULA/link-local.
 *  Internet hostnames that merely start with those digits are not literals. */
export function isPrivateHost(value: string): boolean {
  const host = normalizeHost(value);
  if (!host) return false;
  if (host === "localhost") return true;
  if (host.endsWith(".local")) return true;
  if (host.includes(":")) {
    if (host === "::1") return true;
    if (/^f[cd]/.test(host)) return true;
    if (/^fe[89ab]/.test(host)) return true;
    return false;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return a === 172 && b >= 16 && b <= 31;
}

/** The policy card stays reachable while force-external is on, or the toggle
 *  would lock the operator out of the only UI that can turn it off. */
export function showsExternalPolicyCard(session: SessionClass): boolean {
  return !session.external || session.reason === "force-external";
}

function isHttps(protocol: string): boolean {
  return (
    String(protocol ?? "")
      .trim()
      .toLowerCase()
      .replace(/:$/, "") === "https"
  );
}

/**
 * First match wins: force-external, explicit local, explicit external, private
 * host, https, public http. `no-location` is produced by the reactive resolver,
 * never here.
 */
export function classifySession(args: {
  protocol: string;
  hostname: string;
  settings?: unknown;
}): SessionClass {
  const settings = externalSessionSettings(args.settings);
  const host = normalizeHost(args.hostname);
  if (settings.forceExternal)
    return { external: true, reason: "force-external" };
  if (settings.localHosts.includes(host)) {
    return { external: false, reason: "explicit-local" };
  }
  if (settings.externalHosts.includes(host)) {
    return { external: true, reason: "explicit-external" };
  }
  if (isPrivateHost(host)) return { external: false, reason: "private-host" };
  if (isHttps(args.protocol)) return { external: true, reason: "https" };
  return { external: true, reason: "public-http" };
}
