/** The web adapter base for the current view: the deployed relative base
 *  (`/ihome/`), or the broker's absolute base in dev, where the Vite origin is
 *  not the broker. HTML slots and the bridge use this to build local links
 *  that also work through ioBroker Pro. */
export function appBaseUrl(options: {
  dev: boolean;
  origin: string;
  /** The deployed app's base, e.g. "/ihome/". */
  base?: string;
}): string {
  const base = options.base ?? "/ihome/";
  if (!options.dev) return base;
  const origin = trimOrigin(options.origin);
  return origin ? `${origin}${base}` : base;
}

/** The origin local links should use: the page's own origin in production
 *  (local or ioBroker Pro), the broker's origin in dev. */
export function appOrigin(options: {
  dev: boolean;
  origin: string;
  pageOrigin: string;
}): string {
  return options.dev
    ? trimOrigin(options.origin)
    : trimOrigin(options.pageOrigin);
}

function trimOrigin(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

const APP_PLACEHOLDER = /\{\{\s*\$?(origin|base)\s*\}\}/g;

/** `//path` as a shorthand for the current origin. A first segment that looks
 *  like a host (`example.com`, `192.168.1.5:8082`, `localhost`) keeps the
 *  standard protocol-relative meaning. */
function currentOriginAlias(value: string, origin: string): string {
  if (!value.startsWith("//") || !origin) return value;
  const first = value.slice(2).split(/[/?#]/, 1)[0] ?? "";
  if (
    !first ||
    first.includes(".") ||
    first.includes(":") ||
    first === "localhost"
  ) {
    return value;
  }
  return `${origin}/${value.slice(2)}`;
}

/** Substitute `{{origin}}` (the page/broker origin) and `{{base}}` (the web
 *  adapter base) in an authored URL, and accept `//path` for the current
 *  origin. */
export function resolveAppUrl(
  value: string,
  options: {
    dev: boolean;
    origin: string;
    pageOrigin: string;
    base?: string;
  },
): string {
  const text = String(value ?? "");
  if (!text) return text;
  const origin = appOrigin(options);
  const base = appBaseUrl(options);
  const substituted = text.includes("{{")
    ? text.replace(APP_PLACEHOLDER, (_, key: string) =>
        key === "origin" ? origin : base,
      )
    : text;
  return currentOriginAlias(substituted, origin);
}

/** Where a frame's URL points when the app itself is not served by the
 *  ioBroker web adapter (the Vite dev server).
 *
 *  A frame URL is stored for the deployed app: relative paths resolve against
 *  `/ihome/` and work locally and through ioBroker Pro. The dev server serves
 *  the app at `/`, so the same URL would 404 there; in development it is
 *  resolved against the broker's web origin instead. Production returns the
 *  stored value untouched.
 */
export function frameUrl(
  url: string,
  options: {
    dev: boolean;
    origin: string;
    pageOrigin: string;
    /** The deployed app's base, e.g. "/ihome/". */
    base?: string;
  },
): string {
  const value = resolveAppUrl(url, options).trim();
  if (!value || !options.dev) return value;
  // An absolute URL (or a protocol-relative one) already names its server.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return value;
  }
  try {
    return new URL(value, appBaseUrl(options)).href;
  } catch {
    return value;
  }
}

/**
 * A frame URL read from a state: only a web address (http/https), a
 * protocol-relative address or a relative path. A state is not authored by the
 * editor, so `javascript:`, `data:` and the like must never reach a frame.
 */
export function safeFrameUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  // Detect the scheme on a control-character-free copy, so `java\nscript:`
  // cannot slip past the allowlist.
  const probe = [...text]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 32 && code !== 127;
    })
    .join("");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return "";
  return text;
}
