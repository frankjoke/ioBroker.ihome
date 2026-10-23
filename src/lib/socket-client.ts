// The socket.io client iHome speaks through. Two transports exist in the
// ioBroker world and they are not interchangeable:
//
// - `ws`  — the `@iobroker/ws` client (imported by ioBrokerConnect) against
//           `@iobroker/ws-server`, the admin socket on 8081. Today's local
//           default, and the only thing that works where no web instance
//           serves the page.
// - `io2` — socket.io v2, the client a web instance serves to the apps it
//           hosts (vis, iqontrol, iHome). Loaded from the server itself —
//           `<base>../lib/js/socket.io.js` — so the version always matches
//           the server, and no npm dependency is added. This is the transport
//           that works locally *and* through iobroker.pro.

/** What `connectPlan` decides for one connection. */
export type Connection = {
  transport: "io2" | "ws";
  url: string;
  query?: string;
};

/** Which client is used, at which url, with which options. Pure so the
 *  decision is unit-tested; the DOM side (loading the script) is not. */
export function connectPlan(connection: Connection): {
  client: "io2" | "ws";
  url: string;
  options: Record<string, unknown>;
} {
  if (connection.transport === "io2") {
    return {
      client: "io2",
      url: connection.url,
      // iqontrol's shape: the ioBroker session key in the query, and the
      // client's own reconnection (the ws client also reconnects itself).
      options: { query: connection.query || "key=nokey", reconnection: true },
    };
  }
  return { client: "ws", url: connection.url, options: {} };
}

/** What the web adapter's client looks like, as far as we use it. */
type Io2Client = { connect: (url: string, opts?: object) => unknown };

let loading: Promise<Io2Client | null> | null = null;

/**
 * The socket.io client the page's server offers, or null when it has none
 * (the dev server, a bare PWA) or fails to load. Cached: one script tag per
 * page, however often a connection is retried.
 */
export function loadIo2Client(): Promise<Io2Client | null> {
  loading ??= new Promise<Io2Client | null>((resolve) => {
    const doc = globalThis.document;
    if (!doc) {
      resolve(null);
      return;
    }
    // `@iobroker/ws` installs its own `io` on the global at import time, and
    // the socket.io bundle claims the same name. Keep the ws client as the
    // global (the ws path connects through it) and hand the loaded one back.
    const wsClient = (globalThis as { io?: Io2Client }).io;
    const script = doc.createElement("script");
    // The web adapter serves it next to the apps it hosts: from `/ihome/`
    // that is `/ihome/../lib/js/socket.io.js` → `/lib/js/socket.io.js`.
    script.src = new URL("../lib/js/socket.io.js", doc.baseURI).href;
    script.onload = () => {
      const loaded = (globalThis as { io?: Io2Client }).io;
      if (wsClient) (globalThis as { io?: Io2Client }).io = wsClient;
      resolve(loaded?.connect && loaded !== wsClient ? loaded : null);
    };
    script.onerror = () => resolve(null);
    doc.head.append(script);
  });
  return loading;
}
