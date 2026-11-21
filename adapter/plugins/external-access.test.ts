import { beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginApi } from "../plugin-api";
import {
  caddySnippet,
  createExternalAccessPlugins,
  parseServices,
  parseUsers,
  serializeServices,
  serializeUsers,
  serviceProblem,
  validatePassword,
  validateServiceId,
  validateServicePath,
  validateServiceUpstream,
  validateUsername,
  type ExternalService,
} from "./external-access";

it("rejects unsafe usernames and short passwords", () => {
  expect(validateUsername("alice")).toBe(true);
  expect(validateUsername("alice smith")).toBe(false);
  expect(validateUsername("")).toBe(false);
  expect(validateUsername("a".repeat(33))).toBe(false);
  expect(validatePassword("short")).toBe(false);
  expect(validatePassword("long-enough")).toBe(true);
});

it("serializes users without any plaintext", () => {
  const text = serializeUsers([
    { user: "alice", hash: "$2b$10$abc", note: "Wife", enabled: true },
    { user: "bob", hash: "$2b$10$def", enabled: false },
  ]);
  expect(text).not.toContain("password");
  expect(JSON.parse(text).users).toHaveLength(2);
  expect(parseUsers(text)?.users[1].enabled).toBe(false);
  expect(parseUsers("not json")).toBeNull();
  expect(parseUsers('{"version":2,"users":[]}')).toBeNull();
});

it("writes only enabled users to the snippet", () => {
  expect(
    caddySnippet([
      { user: "bob", hash: "$2b$10$def", enabled: false },
      { user: "alice", hash: "$2b$10$abc", enabled: true },
    ]),
  ).toBe("alice $2b$10$abc\n");
});

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ihome-ext-"));
});

function api(): PluginApi {
  return {
    id: "external-access",
    namespace: "ihome.0",
    config: {},
    settings: {
      dir,
      caddyConfig: "/etc/caddy/Caddyfile",
      reloadCommand: "",
      publicUrl: "",
    },
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  } as unknown as PluginApi;
}

function plugin() {
  const factory = createExternalAccessPlugins()["external-access"];
  return factory(api());
}

it("adds a user with a hash and never returns or stores the password", async () => {
  const mod = plugin();
  const result = (await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
    note: "Wife",
  })) as { users: { user: string; hash?: string }[] };
  expect(result.users.map((u) => u.user)).toEqual(["alice"]);
  expect(result.users[0].hash).toBeUndefined();
  const text = await readFile(join(dir, "users.json"), "utf8");
  expect(text).not.toContain("long-enough");
  expect(text).toContain("$2");
});

it("refuses to overwrite a corrupt users file", async () => {
  await writeFile(join(dir, "users.json"), "{broken");
  const mod = plugin();
  await expect(
    mod.call!({ action: "users.add", user: "bob", password: "long-enough" }),
  ).rejects.toThrow(/unreadable/);
  expect(await readFile(join(dir, "users.json"), "utf8")).toBe("{broken");
});

it("excludes a disabled user from the snippet after writing it", async () => {
  const mod = plugin();
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await mod.call!({
    action: "users.add",
    user: "bob",
    password: "long-enough",
  });
  await mod.call!({ action: "users.setEnabled", user: "bob", enabled: false });
  await mod.call!({ action: "snippet.write" });
  const snippet = await readFile(join(dir, "caddy-users.conf"), "utf8");
  expect(snippet).toContain("alice ");
  expect(snippet).not.toContain("bob ");
});

it("reports a stale snippet in the status", async () => {
  const mod = plugin();
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  const before = (await mod.call!({ action: "status" })) as {
    snippet: { current: boolean };
  };
  expect(before.snippet.current).toBe(false);
  await mod.call!({ action: "snippet.write" });
  const after = (await mod.call!({ action: "status" })) as {
    snippet: { current: boolean };
  };
  expect(after.snippet.current).toBe(true);
});

it("refuses to reload a stale snippet", async () => {
  const mod = plugin();
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await mod.call!({ action: "snippet.write" });
  await mod.call!({
    action: "users.setEnabled",
    user: "alice",
    enabled: false,
  });
  await expect(mod.call!({ action: "caddy.reload" })).rejects.toThrow(/stale/);
});

it("refuses to empty a live snippet when users.json is gone", async () => {
  const mod = plugin();
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await mod.call!({ action: "snippet.write" });
  await rm(join(dir, "users.json"));
  await expect(mod.call!({ action: "snippet.write" })).rejects.toThrow(
    /missing/,
  );
  expect(await readFile(join(dir, "caddy-users.conf"), "utf8")).toContain(
    "alice",
  );
});

it("requires a real boolean for the enabled flag", async () => {
  const mod = plugin();
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await expect(
    mod.call!({ action: "users.setEnabled", user: "alice", enabled: "false" }),
  ).rejects.toThrow(/true or false/);
});

it("validates service ids, paths and upstreams", () => {
  expect(validateServiceId("phone-event")).toBe(true);
  expect(validateServiceId("a b")).toBe(false);
  expect(validateServicePath("/phone-event")).toBe(true);
  expect(validateServicePath("/a/b")).toBe(true);
  expect(validateServicePath("phone-event")).toBe(false);
  expect(validateServicePath("/a/")).toBe(false);
  expect(validateServicePath("/a/*")).toBe(false);
  expect(validateServicePath("/a/../b")).toBe(false);
  expect(validateServiceUpstream("127.0.0.1:3000")).toBe(true);
  expect(validateServiceUpstream("localhost:3000")).toBe(true);
  expect(validateServiceUpstream("[::1]:3000")).toBe(true);
  expect(validateServiceUpstream("192.168.178.9:8082")).toBe(true);
  expect(validateServiceUpstream("172.16.0.5:80")).toBe(true);
  expect(validateServiceUpstream("example.com:443")).toBe(false);
  expect(validateServiceUpstream("http://127.0.0.1:3000")).toBe(false);
  expect(validateServiceUpstream("8.8.8.8:53")).toBe(false);
  expect(validateServiceUpstream("127.0.0.1:0")).toBe(false);
});

it("requires the kind, auth and endpoint combinations", () => {
  expect(
    serviceProblem({
      id: "w",
      kind: "webhook",
      path: "/w",
      endpoint: "/w",
      upstream: "127.0.0.1:3000",
      auth: "basic",
      enabled: true,
    }),
  ).toMatch(/token/);
  expect(
    serviceProblem({
      id: "w",
      kind: "webhook",
      path: "/w",
      endpoint: "w",
      upstream: "127.0.0.1:3000",
      auth: "token",
      enabled: true,
    }),
  ).toBeNull();
  expect(
    serviceProblem({
      id: "p",
      kind: "proxy",
      path: "/p",
      endpoint: "/p",
      upstream: "127.0.0.1:3000",
      auth: "basic",
      enabled: true,
    }),
  ).toMatch(/endpoint/);
  expect(
    serviceProblem({
      id: "p",
      kind: "proxy",
      path: "/p",
      upstream: "127.0.0.1:3000",
      auth: "basic",
      enabled: true,
    }),
  ).toBeNull();
});

it("round-trips services and rejects id, path and prefix conflicts", () => {
  const proxy: ExternalService = {
    id: "opencode",
    kind: "proxy",
    path: "/opencode",
    upstream: "127.0.0.1:49374",
    stripPrefix: true,
    auth: "basic",
    enabled: false,
  };
  const webhook: ExternalService = {
    id: "phone-event",
    kind: "webhook",
    path: "/phone-event",
    endpoint: "/phone-event",
    upstream: "127.0.0.1:3000",
    auth: "token",
    enabled: true,
  };
  expect(parseServices(serializeServices([webhook, proxy]))).toEqual({
    version: 1,
    services: [webhook, proxy],
  });
  expect(parseServices('{"version":2,"services":[]}')).toBeNull();
  expect(
    parseServices(
      serializeServices([webhook, { ...proxy, id: "phone-event" }]),
    ),
  ).toBeNull();
  expect(
    parseServices(
      serializeServices([
        proxy,
        { ...proxy, id: "sub", path: "/opencode/events" },
      ]),
    ),
  ).toBeNull();
  expect(
    parseServices(
      serializeServices([proxy, { ...proxy, id: "other", path: "/opencodex" }]),
    )?.services,
  ).toHaveLength(2);
});
