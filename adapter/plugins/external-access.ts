// External-access management: the Caddy Basic-Auth users behind iHome.
// The plugin owns the user list (bcrypt hashes only) and generates the import
// file for the operator's Caddyfile. It never edits the Caddyfile itself and
// only runs Caddy when asked.

import { exec } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { PluginApi } from "../plugin-api";
import type { PluginFactory } from "../plugin-host";

export interface ExternalUser {
  user: string;
  /** bcrypt hash; never returned to the browser. */
  hash: string;
  note?: string;
  enabled: boolean;
}

export interface UsersFile {
  version: 1;
  users: ExternalUser[];
}

export interface PublicUser {
  user: string;
  note?: string;
  enabled: boolean;
}

const USER_NAME = /^[A-Za-z0-9._-]{1,32}$/;
const MIN_PASSWORD = 8;
const HASH_COST = 10;
const USERS_FILE = "users.json";
const SNIPPET_FILE = "caddy-users.conf";
const SERVICE_ID = /^[A-Za-z0-9._-]{1,32}$/;
const SERVICE_PATH = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;
const MAX_SERVICE_PATH = 64;

export type ServiceKind = "webhook" | "proxy";

export interface ExternalService {
  id: string;
  kind: ServiceKind;
  /** Base path: no trailing slash, no wildcard. */
  path: string;
  /** http.in endpoint path (webhook only), normalized with a leading slash. */
  endpoint?: string;
  /** host:port on loopback or a private address. */
  upstream: string;
  /** Proxy only: strip the service path before proxying. */
  stripPrefix?: boolean;
  auth: "token" | "basic";
  enabled: boolean;
}

export interface ServicesFile {
  version: 1;
  services: ExternalService[];
}

export function validateUsername(value: unknown): value is string {
  return typeof value === "string" && USER_NAME.test(value);
}

export function validatePassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD;
}

/** Null for anything that is not a v1 users document. */
export function parseUsers(text: string): UsersFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.users)) return null;
  const users: ExternalUser[] = [];
  for (const entry of record.users) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (!validateUsername(row.user)) return null;
    if (typeof row.hash !== "string" || row.hash.length < 10) return null;
    const note = typeof row.note === "string" ? row.note.trim() : undefined;
    users.push({
      user: row.user,
      hash: row.hash,
      ...(note ? { note } : {}),
      enabled: row.enabled !== false,
    });
  }
  return { version: 1, users };
}

export function serializeUsers(users: ExternalUser[]): string {
  return `${JSON.stringify({ version: 1, users }, null, 2)}\n`;
}

/** One `user hash` line per enabled user, stable order. */
export function caddySnippet(users: ExternalUser[]): string {
  return users
    .filter((user) => user.enabled)
    .sort((a, b) => a.user.localeCompare(b.user))
    .map((user) => `${user.user} ${user.hash}\n`)
    .join("");
}

function publicUsers(users: ExternalUser[]): PublicUser[] {
  return users.map((user) => ({
    user: user.user,
    ...(user.note ? { note: user.note } : {}),
    enabled: user.enabled,
  }));
}

export function validateServiceId(value: unknown): value is string {
  return typeof value === "string" && SERVICE_ID.test(value);
}

export function validateServicePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SERVICE_PATH)
    return false;
  if (!SERVICE_PATH.test(value)) return false;
  return !value.split("/").some((part) => part === "." || part === "..");
}

function privateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateServiceUpstream(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const at = value.lastIndexOf(":");
  if (at <= 0) return false;
  const host = value.slice(0, at);
  const portText = value.slice(at + 1);
  if (!/^\d{1,5}$/.test(portText)) return false;
  const port = Number(portText);
  if (port < 1 || port > 65_535) return false;
  if (host === "localhost" || host === "[::1]" || host === "127.0.0.1") {
    return true;
  }
  return privateIpv4(host);
}

export function pathsConflict(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Validates one service; returns the normalized row or the first problem. */
export function readService(
  value: unknown,
): { service: ExternalService } | { problem: string } {
  if (!value || typeof value !== "object") {
    return { problem: "A service must be an object." };
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!validateServiceId(id)) {
    return {
      problem: "The service id is not valid (letters, digits, . _ -, max 32).",
    };
  }
  const kind = record.kind;
  if (kind !== "webhook" && kind !== "proxy") {
    return { problem: `Unknown service kind: ${String(kind)}` };
  }
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (!validateServicePath(path)) {
    return {
      problem:
        "The service path must start with / and have no spaces, *, .. or trailing slash.",
    };
  }
  const upstream =
    typeof record.upstream === "string" ? record.upstream.trim() : "";
  if (!validateServiceUpstream(upstream)) {
    return {
      problem:
        "The upstream must be host:port on 127.0.0.1, localhost, [::1] or a private IPv4 address.",
    };
  }
  const enabled = record.enabled !== false;
  if (kind === "webhook") {
    const text =
      typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    const endpoint = text && !text.startsWith("/") ? `/${text}` : text;
    if (!validateServicePath(endpoint)) {
      return { problem: "A webhook needs an http.in endpoint path." };
    }
    if (record.auth !== "token") {
      return { problem: "A webhook must use auth token." };
    }
    if (record.stripPrefix === true) {
      return { problem: "A webhook cannot strip a prefix." };
    }
    return {
      service: { id, kind, path, endpoint, upstream, auth: "token", enabled },
    };
  }
  const endpoint =
    typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  if (endpoint) {
    return { problem: "A proxy must not have an endpoint." };
  }
  if (record.auth !== "basic") {
    return { problem: "A proxy must use auth basic." };
  }
  if (
    record.stripPrefix !== undefined &&
    typeof record.stripPrefix !== "boolean"
  ) {
    return { problem: "stripPrefix must be true or false." };
  }
  return {
    service: {
      id,
      kind,
      path,
      upstream,
      ...(record.stripPrefix === true ? { stripPrefix: true } : {}),
      auth: "basic",
      enabled,
    },
  };
}

export function serviceProblem(value: unknown): string | null {
  const read = readService(value);
  return "problem" in read ? read.problem : null;
}

/** Null for anything that is not a valid v1 services document. */
export function parseServices(text: string): ServicesFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.services)) return null;
  const services: ExternalService[] = [];
  for (const entry of record.services) {
    const read = readService(entry);
    if ("problem" in read) return null;
    const row = read.service;
    if (
      services.some(
        (service) =>
          service.id === row.id || pathsConflict(service.path, row.path),
      )
    ) {
      return null;
    }
    services.push(row);
  }
  return { version: 1, services };
}

export function serializeServices(services: ExternalService[]): string {
  return `${JSON.stringify({ version: 1, services }, null, 2)}\n`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function folder(api: PluginApi): string {
  const dir = text(api.settings.dir);
  if (!dir) {
    throw new Error(
      "Set the data folder in the plugin settings first (Advanced → Plugins → External access).",
    );
  }
  return dir;
}

function caddyConfig(api: PluginApi): string {
  return text(api.settings.caddyConfig) || "/etc/caddy/Caddyfile";
}

function validateCommand(api: PluginApi): string {
  return `caddy validate --config ${quote(caddyConfig(api))}`;
}

function reloadCommand(api: PluginApi): string {
  const own = text(api.settings.reloadCommand);
  return own || `caddy reload --config ${quote(caddyConfig(api))}`;
}

/** Write through a temp file; on any failure the previous bytes are restored. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  let previous: string | null = null;
  try {
    previous = await readFile(path, "utf8");
  } catch {
    previous = null;
  }
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
    const back = await readFile(path, "utf8");
    if (back !== content) {
      throw new Error(`write verification failed: ${path}`);
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (previous !== null) {
      await writeFile(path, previous, "utf8").catch(() => undefined);
    }
    throw error;
  }
}

async function usersFileExists(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, USERS_FILE), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Read users; a missing file is an empty list, a broken file is an error. */
async function readUsers(dir: string): Promise<ExternalUser[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, USERS_FILE), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const parsed = parseUsers(raw);
  if (!parsed) {
    throw new Error(
      `${USERS_FILE} is unreadable — fix or remove it before editing the list.`,
    );
  }
  return parsed.users;
}

async function writeUsers(dir: string, users: ExternalUser[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await atomicWrite(join(dir, USERS_FILE), serializeUsers(users));
}

interface RunResult {
  ok: boolean;
  command: string;
  code: number | string;
  output: string;
}

function run(command: string, cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        const output = [stdout ?? "", stderr ?? "", error?.message ?? ""]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n");
        resolve({
          ok: !error,
          command,
          code: error ? ((error as { code?: number | string }).code ?? 1) : 0,
          output,
        });
      },
    );
  });
}

async function status(api: PluginApi): Promise<unknown> {
  const dir = text(api.settings.dir);
  if (!dir) {
    return {
      folder: { path: "", writable: false },
      users: {
        count: 0,
        enabled: 0,
        problem:
          "Set the data folder in the plugin settings (Advanced → Plugins → External access).",
      },
      snippet: { path: "", exists: false, current: false, users: 0 },
      caddy: {
        config: caddyConfig(api),
        validateCommand: validateCommand(api),
        reloadCommand: reloadCommand(api),
      },
      publicUrl: {},
    };
  }
  let writable = true;
  try {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, `.probe-${process.pid}`);
    await writeFile(probe, "ok", "utf8");
    await rm(probe, { force: true });
  } catch {
    writable = false;
  }

  let users: ExternalUser[] = [];
  let problem: string | undefined;
  try {
    users = await readUsers(dir);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  let snippetText: string | null = null;
  try {
    snippetText = await readFile(join(dir, SNIPPET_FILE), "utf8");
  } catch {
    snippetText = null;
  }
  const expected = caddySnippet(users);

  const url = text(api.settings.publicUrl);
  let publicUrl: Record<string, unknown> = { url };
  if (url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      const protectedSite = response.status === 401 || response.status === 403;
      publicUrl = {
        url,
        status: response.status,
        ok: response.ok || protectedSite,
        ...(protectedSite ? { protected: true } : {}),
      };
    } catch (error) {
      publicUrl = {
        url,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    folder: { path: dir, writable },
    users: {
      count: users.length,
      enabled: users.filter((user) => user.enabled).length,
      ...(problem ? { problem } : {}),
    },
    snippet: {
      path: join(dir, SNIPPET_FILE),
      exists: snippetText !== null,
      current: snippetText === expected,
      users: expected ? expected.trimEnd().split("\n").length : 0,
    },
    caddy: {
      config: caddyConfig(api),
      validateCommand: validateCommand(api),
      reloadCommand: reloadCommand(api),
    },
    publicUrl,
  };
}

async function handle(api: PluginApi, payload: unknown): Promise<unknown> {
  const request =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const action = text(request.action);
  const dir = action === "status" ? "" : folder(api);

  switch (action) {
    case "users.list": {
      const users = await readUsers(dir);
      return { users: publicUsers(users) };
    }
    case "users.add": {
      const user = request.user;
      const password = request.password;
      if (!validateUsername(user)) {
        throw new Error(
          "The user name is not valid (letters, digits, . _ -, max 32).",
        );
      }
      if (!validatePassword(password)) {
        throw new Error(
          `The password must be at least ${MIN_PASSWORD} characters.`,
        );
      }
      const users = await readUsers(dir);
      if (users.some((entry) => entry.user === user)) {
        throw new Error(`The user ${user} already exists.`);
      }
      const hash = await bcrypt.hash(password, HASH_COST);
      const note = text(request.note);
      users.push({ user, hash, ...(note ? { note } : {}), enabled: true });
      await writeUsers(dir, users);
      return { users: publicUsers(users) };
    }
    case "users.setEnabled": {
      const user = request.user;
      const users = await readUsers(dir);
      const entry = users.find((item) => item.user === user);
      if (!entry) throw new Error(`Unknown user: ${String(user)}`);
      if (typeof request.enabled !== "boolean") {
        throw new Error("enabled must be true or false.");
      }
      entry.enabled = request.enabled;
      await writeUsers(dir, users);
      return { users: publicUsers(users) };
    }
    case "users.remove": {
      const user = request.user;
      const users = await readUsers(dir);
      if (!users.some((item) => item.user === user)) {
        throw new Error(`Unknown user: ${String(user)}`);
      }
      const next = users.filter((item) => item.user !== user);
      await writeUsers(dir, next);
      return { users: publicUsers(next) };
    }
    case "snippet.write": {
      const exists = await usersFileExists(dir);
      const users = exists ? await readUsers(dir) : [];
      const content = caddySnippet(users);
      const path = join(dir, SNIPPET_FILE);
      let previous = "";
      try {
        previous = await readFile(path, "utf8");
      } catch {
        previous = "";
      }
      if (!exists && previous.trim()) {
        throw new Error(
          `${USERS_FILE} is missing — refusing to empty the live Caddy snippet.`,
        );
      }
      if (previous !== content) await atomicWrite(path, content);
      return {
        path,
        count: content ? content.trimEnd().split("\n").length : 0,
        changed: previous !== content,
      };
    }
    case "caddy.validate":
      return run(validateCommand(api), dir);
    case "caddy.reload": {
      const expected = caddySnippet(await readUsers(dir));
      let current = "";
      try {
        current = await readFile(join(dir, SNIPPET_FILE), "utf8");
      } catch {
        current = "";
      }
      if (!current)
        throw new Error("Write the snippet before reloading Caddy.");
      if (current !== expected) {
        throw new Error(
          "The snippet is stale — press Write snippet before reloading Caddy.",
        );
      }
      return run(reloadCommand(api), dir);
    }
    case "status":
      return status(api);
    default:
      throw new Error(`Unknown action: ${action || "(none)"}`);
  }
}

export function createExternalAccessPlugins(): Record<string, PluginFactory> {
  return {
    "external-access": (api) => ({
      call: (payload: unknown) => handle(api, payload),
    }),
  };
}
