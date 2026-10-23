/** A `host:port` as the socket.io URL that address serves — the one home for
 *  the `ws://<host:port>/socket.io` shape. Empty in, empty out. */
export function socketUrlFromHostPort(hostPort: string): string {
  return hostPort ? `ws://${hostPort}/socket.io` : "";
}
