// The Caddy user list behind Server & Security → External access. The browser
// never sees a password or a hash: the plugin owns the file and answers with
// the public user rows.

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { callPlugin } from "$lib/config/plugin-call";

export interface ExternalUserView {
  user: string;
  note?: string;
  enabled: boolean;
}

export interface ExternalServiceView {
  id: string;
  kind: "webhook" | "proxy";
  path: string;
  endpoint?: string;
  upstream: string;
  stripPrefix?: boolean;
  auth: "token" | "basic";
  enabled: boolean;
}

const PLUGIN = "external-access";

let users = $state<ExternalUserView[]>([]);
let services = $state<ExternalServiceView[]>([]);
let status = $state<Record<string, unknown> | null>(null);
let snippet = $state<Record<string, unknown> | null>(null);
let problem = $state("");

export function getExternalUsers(): ExternalUserView[] {
  return users;
}

export function getExternalServices(): ExternalServiceView[] {
  return services;
}

export function getExternalStatus(): Record<string, unknown> | null {
  return status;
}

export function getExternalSnippet(): Record<string, unknown> | null {
  return snippet;
}

export function getExternalProblem(): string {
  return problem;
}

function failed(error: unknown): never {
  problem = error instanceof Error ? error.message : String(error);
  throw error;
}

async function call(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    const result = await callPlugin(
      (instance, command, payload) =>
        ioBroker.sendTo(instance, command, payload),
      ioBroker.namespace,
      PLUGIN,
      { action, ...extra },
    );
    problem = "";
    return result;
  } catch (error) {
    return failed(error);
  }
}

function applyUsers(reply: unknown): void {
  if (!reply || typeof reply !== "object") return;
  const rows = (reply as { users?: unknown }).users;
  if (!Array.isArray(rows)) return;
  users = rows.filter(
    (row): row is ExternalUserView =>
      !!row && typeof row === "object" && typeof row.user === "string",
  );
}

function applyServices(reply: unknown): void {
  if (!reply || typeof reply !== "object") return;
  const rows = (reply as { services?: unknown }).services;
  if (!Array.isArray(rows)) return;
  services = rows.filter(
    (row): row is ExternalServiceView =>
      !!row &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string",
  );
}

/** Status first, then the lists; a failure leaves the previous data alone. */
export async function loadExternalAccess(): Promise<void> {
  try {
    await refreshStatus();
    applyUsers(await call("users.list"));
    applyServices(await call("services.list"));
  } catch {
    /* problem already set */
  }
}

/** Re-read the status after a change, so the snippet badge never lies. */
async function refreshStatus(): Promise<void> {
  status = (await call("status")) as Record<string, unknown>;
}

export async function addExternalUser(
  user: string,
  password: string,
  note?: string,
): Promise<void> {
  applyUsers(
    await call("users.add", {
      user,
      password,
      ...(note?.trim() ? { note: note.trim() } : {}),
    }),
  );
}

export async function setExternalUserEnabled(
  user: string,
  enabled: boolean,
): Promise<void> {
  applyUsers(await call("users.setEnabled", { user, enabled }));
  await refreshStatus();
}

export async function removeExternalUser(user: string): Promise<void> {
  applyUsers(await call("users.remove", { user }));
  await refreshStatus();
}

export async function addExternalService(
  service: ExternalServiceView,
): Promise<void> {
  applyServices(await call("services.add", { service }));
  await refreshStatus();
}

export async function updateExternalService(
  service: ExternalServiceView,
): Promise<void> {
  applyServices(await call("services.update", { service }));
  await refreshStatus();
}

export async function setExternalServiceEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const service = services.find((row) => row.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  await updateExternalService({ ...service, enabled });
}

export async function removeExternalService(id: string): Promise<void> {
  applyServices(await call("services.remove", { id }));
  await refreshStatus();
}

export async function writeExternalServicesSnippet(): Promise<unknown> {
  return call("services.write");
}

export async function writeExternalSnippet(): Promise<void> {
  snippet = (await call("snippet.write")) as Record<string, unknown>;
}

export async function validateExternalCaddy(): Promise<unknown> {
  return call("caddy.validate");
}

export async function reloadExternalCaddy(): Promise<unknown> {
  return call("caddy.reload");
}
