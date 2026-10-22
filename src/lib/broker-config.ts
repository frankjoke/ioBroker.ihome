/**
 * The broker a locally started PWA talks to: home-screen launch, `npm run dev`,
 * `npm run preview` — none of them is served by a broker.
 *
 * It is used only when the page brings no connection data (`?socket=`,
 * `VITE_SOCKET_URL`) and nothing is stored under `__VISUAL__:hostPort`. The
 * value is a `host:port` that becomes `ws://<value>/socket.io` — plain `ws://`,
 * like the stored setting, so an https deployment behind a reverse proxy still
 * needs `?socket=`.
 *
 * The shipped default must stay empty: `www/` is published, and a pinned
 * private address would send every other installation at someone else's LAN.
 * An operator's own value belongs in the untracked `.env.*` or in the app's own
 * settings.
 */
export const FALLBACK_BROKER = "";
