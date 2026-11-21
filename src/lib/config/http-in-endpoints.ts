// The `http.in` plugin view as the Caddy card needs it: endpoints, their
// effective token and port. Endpoint objects stay raw for read-modify-write.

export interface HttpInEndpoint {
  path: string;
  method: string;
  token: string;
  port?: number;
}

export interface HttpInView {
  endpoints: HttpInEndpoint[];
  globalToken: string;
  defaultPort: number;
}

const DEFAULT_PORT = 8095;

export function normalizeHttpInPath(value: string): string {
  return `/${value.trim().replace(/^\/+|\/+$/g, "")}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The raw endpoint array from the settings value (string or array). */
export function endpointArray(raw: unknown): unknown[] {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed : [];
}

export function parseHttpInSettings(
  settings: Record<string, unknown> | undefined,
): HttpInView {
  const source = settings ?? {};
  const endpoints: HttpInEndpoint[] = [];
  for (const entry of endpointArray(source.endpoints)) {
    if (!record(entry)) continue;
    const path = typeof entry.path === "string" ? entry.path.trim() : "";
    if (!path) continue;
    const endpoint: HttpInEndpoint = {
      path: normalizeHttpInPath(path),
      method:
        typeof entry.method === "string" && entry.method.trim()
          ? entry.method.trim().toUpperCase()
          : "GET",
      token: typeof entry.token === "string" ? entry.token : "",
    };
    if (
      typeof entry.port === "number" &&
      Number.isInteger(entry.port) &&
      entry.port > 0 &&
      entry.port <= 65_535
    ) {
      endpoint.port = entry.port;
    }
    endpoints.push(endpoint);
  }
  const port = Number(source.port);
  return {
    endpoints,
    globalToken: typeof source.token === "string" ? source.token : "",
    defaultPort:
      Number.isInteger(port) && port > 0 && port <= 65_535
        ? port
        : DEFAULT_PORT,
  };
}

export function endpointToken(
  endpoint: HttpInEndpoint | undefined,
  globalToken: string,
): { token: string; source: "endpoint" | "global" | "none" } {
  if (endpoint?.token) return { token: endpoint.token, source: "endpoint" };
  if (globalToken) return { token: globalToken, source: "global" };
  return { token: "", source: "none" };
}
