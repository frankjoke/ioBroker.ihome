/**
 * Where the SPA talks to ioBroker: the host that served the page (the web
 * adapter serves /ihome/), socket.io on port 8081. `VITE_SOCKET_URL` (dev,
 * .env.development.local) and `?socket=…` (reverse proxies) win over that.
 */
export function defaultSocketUrl(): string {
  return (
    import.meta.env.VITE_SOCKET_URL ||
    new URLSearchParams(location.search).get("socket") ||
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8081/socket.io`
  );
}
