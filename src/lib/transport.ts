// How iHome finds its transport. ioBroker's own rule for an app served by a
// web instance is the `_socket/info.js` file next to it — the web adapter
// writes `var socketUrl`, `var socketPath` and `var socketSession` there (all
// empty on a plain local instance, which means "this origin, /socket.io").
//
// The file is parsed, never executed: through iobroker.pro the cloud answers
// that path with a login-redirect stub, and running it would navigate the app
// to the portal. The *presence* of an answer is what tells us a web instance
// is serving this page; its values are a bonus.

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
