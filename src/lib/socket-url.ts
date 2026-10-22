import { FALLBACK_BROKER } from "./broker-config";

/** A `host:port` as the socket.io URL that address serves — the one home for
 *  the `ws://<host:port>/socket.io` shape. Empty in, empty out. */
export function socketUrlFromHostPort(hostPort: string): string {
  return hostPort ? `ws://${hostPort}/socket.io` : "";
}

/** Where the SPA talks to ioBroker, in order: `VITE_SOCKET_URL` (dev,
 *  .env.development.local), `?socket=…` (reverse proxies), the configured
 *  broker fallback (`FALLBACK_BROKER`, for a locally started PWA), and finally
 *  the host that served the page (the web adapter serves /ihome/), socket.io
 *  on port 8081 — `wss` when the page is https. */
export function resolveSocketUrl(sources: {
  env?: string;
  query?: string | null;
  configured?: string;
  protocol: string;
  hostname: string;
}): string {
  return (
    sources.env ||
    sources.query ||
    socketUrlFromHostPort(sources.configured ?? "") ||
    `${sources.protocol === "https:" ? "wss" : "ws"}://${sources.hostname}:8081/socket.io`
  );
}

/** The order above, read from this page: `VITE_SOCKET_URL`, `?socket=`, the
 *  configured fallback, then the host that served it. */
export function defaultSocketUrl(): string {
  return resolveSocketUrl({
    env: import.meta.env.VITE_SOCKET_URL,
    query: new URLSearchParams(location.search).get("socket"),
    configured: FALLBACK_BROKER,
    protocol: location.protocol,
    hostname: location.hostname,
  });
}
