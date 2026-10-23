// How iHome finds its transport. ioBroker's own rule for an app served by a
// web instance is the `_socket/info.js` file next to it — the web adapter
// writes `var socketUrl`, `var socketPath` and `var socketSession` there (all
// empty on a plain local instance, which means "this origin, /socket.io").
//
// The file is parsed, never executed: through iobroker.pro the cloud answers
// that path with a login-redirect stub, and running it would navigate the app
// to the portal. The *presence* of an answer is what tells us a web instance
// is serving this page; its values are a bonus.

import { socketUrlFromHostPort } from "$lib/socket-url";

/** `var <name> = "…";` as the web adapter writes it (single quotes tolerated). */
function declaration(name: string): RegExp {
  return new RegExp(`var\\s+${name}\\s*=\\s*(['"])([^'"]*)\\1\\s*;`);
}

/**
 * The socket info the file declares, or null when it does not. A redirect
 * stub, a 404 body and anything else without both declarations mean "no
 * information" — the caller then treats the page as not web-served.
 */
export function parseSocketInfo(text: string): {
  socketUrl: string;
  socketSession: string;
} | null {
  const url = declaration("socketUrl").exec(String(text ?? ""));
  const session = declaration("socketSession").exec(String(text ?? ""));
  if (!url || !session) return null;
  return { socketUrl: url[2], socketSession: session[2] };
}

/**
 * What the info file told us, or `null` when it did not answer at all. An
 * object — even an empty one — means a web instance served this page, which is
 * the fact the rule table below needs; its values are a bonus.
 */
export type Info = { socketUrl?: string; socketSession?: string } | null;

/** Where the answer comes from, in the order the spec fixes. */
export type Sources = {
  /** `VITE_SOCKET_URL` or `?socket=` — an address the operator pinned. */
  explicit?: string;
  /** The Settings' host:port — also an operator's choice. */
  hostPort?: string;
  origin: string;
  host: string;
  protocol: string;
  info: Info;
};

/** `host:port` without its port — what a bare `:port` socketUrl prefixes. */
function hostnameOf(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * The spec's table, in order:
 * 1. an explicit address (the ws client, exactly as given),
 * 2. the stored `host:port` (the ws client, `…/socket.io`),
 * 3. a page served by a web instance (its own socket.io at the page's origin,
 *    or wherever the info file points, with `key=<session|nokey>`),
 * 4. today's default — the host on the admin port.
 */
export function resolveTransport(sources: Sources): {
  transport: "io2" | "ws";
  url: string;
  query?: string;
} {
  if (sources.explicit) return { transport: "ws", url: sources.explicit };
  const stored = socketUrlFromHostPort(sources.hostPort ?? "");
  if (stored) return { transport: "ws", url: stored };
  if (sources.info) {
    const raw = sources.info.socketUrl ?? "";
    // A bare ":port" keeps the page's protocol and host (iqontrol's rule).
    const url = raw.startsWith(":")
      ? `${sources.protocol}//${hostnameOf(sources.host)}${raw}`
      : raw || sources.origin;
    return {
      transport: "io2",
      url,
      query: `key=${sources.info.socketSession || "nokey"}`,
    };
  }
  const scheme = sources.protocol === "https:" ? "wss" : "ws";
  return {
    transport: "ws",
    url: `${scheme}://${hostnameOf(sources.host)}:8081/socket.io`,
  };
}

/** A host as something to compare: scheme and path stripped, lower-cased. */
function hostOnly(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/**
 * The cloud page for this app: the configured host plus the path the app is
 * already served under, so the jump lands on the same app (`/ihome/`). The
 * host may be given with a scheme; a trailing slash is tolerated. Null when
 * nothing is configured.
 */
export function cloudPageUrl(host: string, pathname: string): string | null {
  const trimmed = String(host ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!trimmed) return null;
  const base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `${base}${pathname || "/"}`;
}

/**
 * Whether a failed local connect should hand over to the cloud page. Only
 * when the operator enabled it, named a host, pinned no address of their own
 * (`?socket=` or the stored `host:port` — those are answers, not failures),
 * and is not already looking at the cloud (which would loop).
 */
export function shouldJumpToCloud(sources: {
  enabled: boolean;
  cloudHost: string;
  explicit?: string;
  hostPort?: string;
  pageHost: string;
}): boolean {
  if (!sources.enabled) return false;
  if (sources.explicit || sources.hostPort) return false;
  const target = cloudPageUrl(sources.cloudHost, "/");
  if (!target) return false;
  return hostOnly(target) !== hostOnly(sources.pageHost);
}

/**
 * The same table with the info file fetched. Any answer counts as "served" —
 * the cloud's redirect stub has no values but still proves a web instance is
 * serving the page — and any failure, timeout or garbage means "not served".
 */
export async function resolveConnection(
  sources: Sources & { fetchInfo: () => Promise<string | null> },
): Promise<ReturnType<typeof resolveTransport>> {
  let info: Info = null;
  try {
    const text = await sources.fetchInfo();
    if (text !== null) info = parseSocketInfo(text) ?? {};
  } catch {
    info = null;
  }
  // `resolveTransport` ignores the extra `fetchInfo` — the answer is `info`.
  return resolveTransport({ ...sources, info });
}
