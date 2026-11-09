import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { PluginApi } from "../plugin-api";
import type { PluginFactory } from "../plugin-host";

export interface HttpTarget {
  state: string;
  name?: string;
  type?: "number" | "string" | "boolean";
  role?: string;
  unit?: string;
  /** JS expression over $ (the received data); defaults to $. */
  value?: string;
  /** JS expression over the extracted value; defaults to the value. */
  transform?: string;
}

export interface HttpEndpoint {
  path: string;
  method: string;
  target?: string;
  targets?: HttpTarget[];
  /** Sent on success; a string is text, anything else JSON. */
  reply?: unknown;
}

export interface HttpSettings {
  bind: string;
  port: number;
  token: string;
  endpoints: HttpEndpoint[];
}

export interface HttpTargetWrite {
  state: string;
  value: unknown;
  type: "number" | "string" | "boolean";
  role?: string;
  unit?: string;
  name?: string;
}

export interface HttpRequestInput {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  token: string;
}

export interface HttpRequestResult {
  status: number;
  error?: string;
  writes: HttpTargetWrite[];
  reply?: unknown;
}

const DEFAULT_PORT = 8095;
const MAX_BODY = 1_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeHttpPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  return `/${trimmed}`;
}

function targetOf(value: unknown): HttpTarget {
  if (!record(value)) throw new Error("each target must be an object");
  const state = typeof value.state === "string" ? value.state.trim() : "";
  if (!state) throw new Error("each target needs a state id");
  const target: HttpTarget = { state };
  if (value.name !== undefined) {
    if (typeof value.name !== "string")
      throw new Error("target name must be text");
    target.name = value.name;
  }
  if (value.type !== undefined) {
    if (!["number", "string", "boolean"].includes(String(value.type))) {
      throw new Error(
        `target ${state}: type must be number, string or boolean`,
      );
    }
    target.type = value.type as HttpTarget["type"];
  }
  if (value.role !== undefined) {
    if (typeof value.role !== "string")
      throw new Error("target role must be text");
    target.role = value.role;
  }
  if (value.unit !== undefined) {
    if (typeof value.unit !== "string")
      throw new Error("target unit must be text");
    target.unit = value.unit;
  }
  if (value.value !== undefined) {
    if (typeof value.value !== "string")
      throw new Error("target value must be text");
    target.value = value.value;
  }
  if (value.transform !== undefined) {
    if (typeof value.transform !== "string") {
      throw new Error("target transform must be text");
    }
    target.transform = value.transform;
  }
  return target;
}

export function parseHttpEndpoints(value: unknown): HttpEndpoint[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error("endpoints must be valid JSON");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("endpoints must be an array");
  return parsed.map((entry, index) => {
    if (!record(entry))
      throw new Error(`endpoint ${index + 1} must be an object`);
    const path = typeof entry.path === "string" ? entry.path.trim() : "";
    if (!path) throw new Error(`endpoint ${index + 1} needs a path`);
    const method =
      typeof entry.method === "string" && entry.method.trim()
        ? entry.method.trim().toUpperCase()
        : "GET";
    const target =
      typeof entry.target === "string" && entry.target.trim()
        ? entry.target.trim()
        : undefined;
    const targets = Array.isArray(entry.targets)
      ? entry.targets.map(targetOf)
      : undefined;
    if (!target && !targets?.length) {
      throw new Error(`endpoint ${path} needs a target or targets list`);
    }
    return {
      path: normalizeHttpPath(path),
      method,
      ...(target ? { target } : {}),
      ...(targets?.length ? { targets } : {}),
      ...(entry.reply !== undefined ? { reply: entry.reply } : {}),
    };
  });
}

export function parseHttpSettings(
  settings: Record<string, unknown>,
): HttpSettings {
  const portValue = Number(settings.port);
  const port =
    Number.isInteger(portValue) && portValue > 0 && portValue <= 65_535
      ? portValue
      : DEFAULT_PORT;
  const bind =
    typeof settings.bind === "string" && settings.bind.trim()
      ? settings.bind.trim()
      : "0.0.0.0";
  const token = typeof settings.token === "string" ? settings.token : "";
  const endpoints = parseHttpEndpoints(settings.endpoints ?? "[]");
  return { bind, port, token, endpoints };
}

export function matchHttpEndpoint(
  endpoints: HttpEndpoint[],
  method: string,
  path: string,
): HttpEndpoint | undefined {
  const normalized = normalizeHttpPath(path);
  const upper = method.toUpperCase();
  return endpoints.find(
    (endpoint) => endpoint.path === normalized && endpoint.method === upper,
  );
}

export function buildRequestData(
  query: Record<string, string>,
  body: unknown,
): unknown {
  if (record(body)) return { ...query, ...body };
  if (body !== undefined) return body;
  return query;
}

function evaluate(expression: string | undefined, data: unknown): unknown {
  if (!expression || !expression.trim() || expression.trim() === "$") {
    return data;
  }
  return new Function("$", `return (${expression});`)(data);
}

function evaluateTransform(
  expression: string,
  value: unknown,
  data: unknown,
): unknown {
  return new Function("value", "$", `return (${expression});`)(value, data);
}

function inferType(value: unknown): "number" | "string" | "boolean" {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function coerceValue(
  value: unknown,
  type: "number" | "string" | "boolean",
): unknown {
  if (type === "number") return Number(value);
  if (type === "boolean") return Boolean(value);
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function targetWrites(
  endpoint: HttpEndpoint,
  data: unknown,
): HttpTargetWrite[] {
  if (endpoint.target) {
    return [
      {
        state: endpoint.target,
        value: typeof data === "string" ? data : JSON.stringify(data ?? null),
        type: "string",
        role: "text.json",
      },
    ];
  }
  const writes: HttpTargetWrite[] = [];
  for (const target of endpoint.targets ?? []) {
    const raw = evaluate(target.value, data);
    const transformed =
      target.transform === undefined
        ? raw
        : evaluateTransform(target.transform, raw, data);
    if (transformed === undefined) continue;
    const type = target.type ?? inferType(transformed);
    writes.push({
      state: target.state,
      value: coerceValue(transformed, type),
      type,
      role: target.role,
      ...(target.unit ? { unit: target.unit } : {}),
      ...(target.name ? { name: target.name } : {}),
    });
  }
  return writes;
}

export function processHttpRequest(
  settings: Pick<HttpSettings, "endpoints" | "token">,
  input: HttpRequestInput,
): HttpRequestResult {
  if (settings.token && input.token !== settings.token) {
    return { status: 401, error: "invalid token", writes: [] };
  }
  const normalized = normalizeHttpPath(input.path);
  const endpoint = settings.endpoints.find(
    (entry) => entry.path === normalized,
  );
  if (!endpoint) {
    return { status: 404, error: "unknown path", writes: [] };
  }
  if (endpoint.method !== input.method.toUpperCase()) {
    return { status: 405, error: "method not allowed", writes: [] };
  }
  try {
    const data = buildRequestData(input.query, input.body);
    return {
      status: 200,
      writes: targetWrites(endpoint, data),
      ...(endpoint.reply !== undefined ? { reply: endpoint.reply } : {}),
    };
  } catch (error) {
    return {
      status: 500,
      error: error instanceof Error ? error.message : String(error),
      writes: [],
    };
  }
}

export async function applyHttpWrites(
  api: PluginApi,
  writes: HttpTargetWrite[],
): Promise<void> {
  for (const write of writes) {
    const own = write.state.startsWith(`${api.namespace}.`);
    const existing = own
      ? await api.objects.get(write.state)
      : await api.objects.getForeign(write.state);
    if (!existing) {
      const object = {
        type: "state",
        common: {
          name: write.name ?? write.state,
          type: write.type,
          role: write.role ?? "value",
          ...(write.unit ? { unit: write.unit } : {}),
          read: true,
          write: false,
        },
        native: {},
      };
      if (own) await api.objects.set(write.state, object);
      else await api.objects.setForeign(write.state, object);
    }
    if (own) await api.state.set(write.state, write.value, { ack: true });
    else await api.state.setForeign(write.state, write.value, { ack: true });
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(text: string, contentType: string): unknown {
  if (!text.trim()) return undefined;
  const type = contentType.toLowerCase();
  if (type.includes("application/json") || type.includes("+json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "body is not valid JSON");
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "body is not valid JSON");
    }
  }
  return text;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requestToken(
  query: Record<string, string>,
  headers: IncomingMessage["headers"],
): string {
  const header = headers["x-ihome-token"];
  if (typeof header === "string") return header;
  return query.token ?? "";
}

async function handleRequest(
  api: PluginApi,
  settings: HttpSettings,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const query = Object.fromEntries(url.searchParams);
    const token = requestToken(query, req.headers);
    delete query.token;
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : parseBody(
            await readBody(req),
            String(req.headers["content-type"] ?? ""),
          );
    const result = processHttpRequest(settings, {
      method: req.method ?? "GET",
      path: url.pathname,
      query,
      body,
      token,
    });
    if (result.status === 200) {
      try {
        await applyHttpWrites(api, result.writes);
      } catch (error) {
        throw new HttpError(
          500,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (result.reply !== undefined) {
        const text = typeof result.reply === "string";
        res.writeHead(200, {
          "content-type": text
            ? "text/plain; charset=utf-8"
            : "application/json; charset=utf-8",
        });
        res.end(text ? result.reply : JSON.stringify(result.reply));
        return;
      }
    }
    res.writeHead(result.status, {
      "content-type": "application/json; charset=utf-8",
    });
    res.end(
      JSON.stringify(
        result.status === 200
          ? { ok: true, wrote: result.writes.length }
          : { ok: false, error: result.error },
      ),
    );
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    api.log.warn(`http.in ${req.method} ${req.url}: ${message}`);
    if (!res.headersSent) {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ ok: false, error: message }));
    } else {
      res.end();
    }
  }
}

export function createHttpPlugins(): Record<string, PluginFactory> {
  return {
    "http.in": (api) => {
      let server: Server | null = null;
      let current: HttpSettings | null = null;

      async function start(): Promise<void> {
        const settings = parseHttpSettings(api.settings);
        const next = createServer((req, res) => {
          void handleRequest(api, settings, req, res);
        });
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => reject(error);
          next.once("error", onError);
          next.listen(settings.port, settings.bind, () => {
            next.removeListener("error", onError);
            resolve();
          });
        });
        next.on("error", (error) => {
          api.log.error(`http.in: ${error.message}`);
        });
        server = next;
        current = settings;
        api.log.info(
          `http.in listening on ${settings.bind}:${settings.port} (${settings.endpoints.length} endpoint(s))`,
        );
      }

      async function stop(): Promise<void> {
        const active = server;
        server = null;
        current = null;
        if (!active) return;
        await new Promise<void>((resolve) => {
          active.close(() => resolve());
          active.closeAllConnections?.();
        });
      }

      return {
        async start() {
          await start();
        },
        async call() {
          return { ok: true, listening: !!server, port: current?.port };
        },
        async reload() {
          await stop();
          await start();
        },
        async stop() {
          await stop();
        },
      };
    },
  };
}
