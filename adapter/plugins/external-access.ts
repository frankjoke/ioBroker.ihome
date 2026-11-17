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

/** The previous file stays in place until the temp file is renamed over it. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
  const back = await readFile(path, "utf8");
  if (back !== content) {
    throw new Error(`write verification failed: ${path}`);
  }
}

/** Read users; a missing file is an empty list, a broken file is an error. */
async function readUsers(dir: string): Promise<ExternalUser[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, USERS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
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
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
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
  const dir = folder(api);
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
      publicUrl = { url, status: response.status, ok: response.ok };
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
        throw new Error("The user name is not valid (letters, digits, . _ -, max 32).");
      }
      if (!validatePassword(password)) {
        throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
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
      entry.enabled = request.enabled !== false;
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
      const users = await readUsers(dir);
      const content = caddySnippet(users);
      const path = join(dir, SNIPPET_FILE);
      let previous = "";
      try {
        previous = await readFile(path, "utf8");
      } catch {
        previous = "";
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
      try {
        await readFile(join(dir, SNIPPET_FILE), "utf8");
      } catch {
        throw new Error("Write the snippet before reloading Caddy.");
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
