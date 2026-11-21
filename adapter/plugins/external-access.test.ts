import { beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginApi } from "../plugin-api";
import {
  caddyServicesSnippet,
  caddySitesSnippet,
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
  validateThenReload,
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

function api(overrides: Record<string, unknown> = {}): PluginApi {
  return {
    id: "external-access",
    namespace: "ihome.0",
    config: {},
    settings: {
      dir,
      caddyConfig: "/etc/caddy/Caddyfile",
      reloadCommand: "",
      publicUrl: "",
      ...overrides,
    },
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  } as unknown as PluginApi;
}

function plugin(overrides: Record<string, unknown> = {}) {
  const factory = createExternalAccessPlugins()["external-access"];
  return factory(api(overrides));
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
  expect(
    parseServices(
      serializeServices([proxy, { ...proxy, id: "upper", path: "/OpenCode" }]),
    ),
  ).toBeNull();
});

it("generates webhook and proxy blocks in a stable order", () => {
  const users = "/data/caddy-users.conf";
  const snippet = caddyServicesSnippet(
    [
      {
        id: "phone-event",
        kind: "webhook",
        path: "/phone-event",
        endpoint: "/phone-event",
        upstream: "127.0.0.1:3000",
        auth: "token",
        enabled: true,
      },
      {
        id: "opencode",
        kind: "proxy",
        path: "/opencode",
        upstream: "127.0.0.1:49374",
        stripPrefix: true,
        auth: "basic",
        enabled: true,
      },
      {
        id: "plain",
        kind: "proxy",
        path: "/plain",
        upstream: "192.168.178.5:8080",
        auth: "basic",
        enabled: false,
      },
    ],
    users,
  );
  expect(snippet).toBe(
    `# generated by iHome Caddy services — do not edit\n\n` +
      `handle /phone-event {\n\treverse_proxy 127.0.0.1:3000\n}\n\n` +
      `handle_path /opencode/* {\n\tbasic_auth {\n\t\timport /data/caddy-users.conf\n\t}\n\treverse_proxy 127.0.0.1:49374\n}\n`,
  );
  expect(caddyServicesSnippet([], users)).toBe(
    `# generated by iHome Caddy services — do not edit\n`,
  );
});

it("adds a webhook service and writes the snippet", async () => {
  const mod = plugin();
  const result = (await mod.call!({
    action: "services.add",
    service: {
      id: "phone-event",
      kind: "webhook",
      path: "/phone-event",
      endpoint: "phone-event",
      upstream: "127.0.0.1:3000",
      auth: "token",
      enabled: true,
    },
  })) as { services: ExternalService[]; snippet: { changed: boolean } };
  expect(result.services[0].endpoint).toBe("/phone-event");
  expect(result.snippet.changed).toBe(true);
  expect(await readFile(join(dir, "services.json"), "utf8")).toContain(
    "/phone-event",
  );
  const snippet = await readFile(join(dir, "caddy-services.conf"), "utf8");
  expect(snippet).toContain("handle /phone-event {");
  expect(snippet).not.toContain("basic_auth");
});

it("rejects duplicate ids, paths and overlapping paths", async () => {
  const mod = plugin();
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "a",
        kind: "proxy",
        path: "/b",
        upstream: "127.0.0.1:1",
        auth: "basic",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/id/);
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "b",
        kind: "proxy",
        path: "/a",
        upstream: "127.0.0.1:1",
        auth: "basic",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/path/);
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "b",
        kind: "proxy",
        path: "/a/sub",
        upstream: "127.0.0.1:1",
        auth: "basic",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/overlap/);
});

it("updates, disables and removes services, regenerating the snippet", async () => {
  const mod = plugin();
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await mod.call!({
    action: "services.update",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:2",
      auth: "basic",
      enabled: false,
    },
  });
  expect(
    await readFile(join(dir, "caddy-services.conf"), "utf8"),
  ).not.toContain("handle /a");
  await mod.call!({ action: "services.remove", id: "a" });
  expect(
    JSON.parse(await readFile(join(dir, "services.json"), "utf8")).services,
  ).toEqual([]);
});

it("refuses to empty a live snippet when services.json is gone", async () => {
  const mod = plugin();
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await rm(join(dir, "services.json"));
  await expect(mod.call!({ action: "services.write" })).rejects.toThrow(
    /missing/,
  );
  expect(await readFile(join(dir, "caddy-services.conf"), "utf8")).toContain(
    "handle /a",
  );
});

it("refuses to overwrite a corrupt services file", async () => {
  await writeFile(join(dir, "services.json"), "{broken");
  const mod = plugin();
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "a",
        kind: "proxy",
        path: "/a",
        upstream: "127.0.0.1:1",
        auth: "basic",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/unreadable/);
  expect(await readFile(join(dir, "services.json"), "utf8")).toBe("{broken");
});

it("reports the services snippet and the Caddyfile import in status", async () => {
  const caddyfile = join(dir, "Caddyfile");
  const mod = plugin({ caddyConfig: caddyfile });
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await writeFile(caddyfile, "home.example.net {\n\thandle {\n\t}\n}\n");
  let status = (await mod.call!({ action: "status" })) as any;
  expect(status.servicesSnippet).toMatchObject({
    exists: true,
    current: true,
    blocks: 1,
  });
  expect(status.services).toMatchObject({ count: 1, enabled: 1 });
  expect(status.caddy.importsSnippet).toBe(false);
  await writeFile(
    caddyfile,
    `home.example.net {\n\timport ${join(dir, "caddy-services.conf")}\n}\n`,
  );
  status = (await mod.call!({ action: "status" })) as any;
  expect(status.caddy.importsSnippet).toBe(true);
  await mod.call!({
    action: "services.update",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: false,
    },
  });
  status = (await mod.call!({ action: "status" })) as any;
  expect(status.servicesSnippet.current).toBe(true);
});

it("refuses to reload a stale services snippet", async () => {
  const caddyfile = join(dir, "Caddyfile");
  await writeFile(caddyfile, "x {}\n");
  const mod = plugin({
    caddyConfig: caddyfile,
    reloadCommand: 'node -e "process.exit(0)"',
  });
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await mod.call!({ action: "snippet.write" });
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await writeFile(
    join(dir, "services.json"),
    serializeServices([
      {
        id: "a",
        kind: "proxy",
        path: "/a",
        upstream: "127.0.0.1:2",
        auth: "basic",
        enabled: true,
      },
    ]),
  );
  await expect(mod.call!({ action: "caddy.reload" })).rejects.toThrow(
    /services snippet is stale/,
  );
});

it("validates before reloading and aborts on failure", async () => {
  const calls: string[] = [];
  const run = async (command: string) => {
    calls.push(command);
    return {
      ok: command !== "bad",
      command,
      code: command === "bad" ? 1 : 0,
      output: "",
    };
  };
  expect(await validateThenReload(run, "bad", "reload")).toMatchObject({
    ok: false,
    command: "bad",
  });
  expect(calls).toEqual(["bad"]);
  calls.length = 0;
  expect(await validateThenReload(run, "validate", "reload")).toMatchObject({
    ok: true,
    command: "reload",
  });
  expect(calls).toEqual(["validate", "reload"]);
});

it("refuses to add a service when services.json is gone but the snippet is live", async () => {
  const mod = plugin();
  await mod.call!({
    action: "services.add",
    service: {
      id: "a",
      kind: "proxy",
      path: "/a",
      upstream: "127.0.0.1:1",
      auth: "basic",
      enabled: true,
    },
  });
  await rm(join(dir, "services.json"));
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "b",
        kind: "proxy",
        path: "/b",
        upstream: "127.0.0.1:2",
        auth: "basic",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/missing/);
  const snippet = await readFile(join(dir, "caddy-services.conf"), "utf8");
  expect(snippet).toContain("handle /a");
  expect(snippet).not.toContain("handle /b");
});

it("applies settings without an adapter restart", () => {
  const mod = plugin();
  expect(typeof mod.reload).toBe("function");
  expect(mod.reload!()).toBeUndefined();
});

it("validates site services and rejects duplicate ports", () => {
  const site = {
    id: "opencode",
    kind: "site" as const,
    port: 8444,
    upstream: "127.0.0.1:49374",
    auth: "none" as const,
    enabled: true,
  };
  expect(serviceProblem(site)).toBeNull();
  expect(serviceProblem({ ...site, path: "/x" })).toMatch(/path/);
  expect(serviceProblem({ ...site, port: 443 })).toMatch(/port/);
  expect(serviceProblem({ ...site, port: 70000 })).toMatch(/port/);
  expect(serviceProblem({ ...site, auth: "token" })).toMatch(/auth/);
  expect(serviceProblem({ ...site, stripPrefix: true })).toMatch(/prefix/);
  expect(parseServices(serializeServices([site]))?.services[0]).toEqual(site);
  expect(
    parseServices(
      serializeServices([site, { ...site, id: "other", port: 8444 }]),
    ),
  ).toBeNull();
});

it("creates one-time pairing links and reports failures without the password", async () => {
  let mode: "ok" | "404" | "nocode" = "ok";
  let seenAuth = "";
  let pairCalls = 0;
  let port = 0;
  const server = createServer((req, res) => {
    seenAuth = String(req.headers.authorization ?? "");
    if (req.method === "POST" && req.url === "/api/pair") {
      pairCalls += 1;
      if (mode === "404") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          mode === "nocode" ? { expires_in: 300 } : { code: "ABC", expires_in: 300 },
        ),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/api/info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          urls: [
            `http://127.0.0.1:${port}`,
            `http://192.168.1.5:${port}`,
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  port = (server.address() as AddressInfo).port;
  const passwordFile = join(dir, "opencode-password");
  await writeFile(passwordFile, "secret\n");
  const site = {
    id: "site-8444",
    kind: "site" as const,
    port: 8444,
    upstream: `127.0.0.1:${port}`,
    auth: "none" as const,
    enabled: true,
  };
  await writeFile(
    join(dir, "services.json"),
    serializeServices([site]),
  );
  try {
    const mod = plugin({
      publicUrl: "https://home.example.net/ihome/",
      opencodePasswordFile: passwordFile,
    });
    await expect(
      mod.call!({ action: "site.pair", id: "site-8444" }),
    ).resolves.toEqual({
      external: "https://home.example.net:8444/auth/connect/ABC",
      internal: `http://192.168.1.5:${port}/auth/connect/ABC`,
      expiresIn: 300,
    });
    expect(seenAuth).toBe(
      `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    );
    expect(pairCalls).toBe(1);

    await expect(
      plugin({ opencodePasswordFile: passwordFile }).call!({
        action: "site.pair",
        id: "site-8444",
      }),
    ).rejects.toThrow(/public URL/i);

    await expect(
      mod.call!({ action: "site.pair", id: "missing" }),
    ).rejects.toThrow(/site/i);

    await writeFile(
      join(dir, "services.json"),
      serializeServices([{ ...site, upstream: "192.168.1.9:49374" }]),
    );
    await expect(
      mod.call!({ action: "site.pair", id: "site-8444" }),
    ).rejects.toThrow(/loopback/i);
    await writeFile(join(dir, "services.json"), serializeServices([site]));

    const broken = plugin({
      publicUrl: "https://home.example.net/ihome/",
      opencodePasswordFile: join(dir, "missing-password"),
    });
    await expect(
      broken.call!({ action: "site.pair", id: "site-8444" }),
    ).rejects.toThrow(/password/i);

    mode = "404";
    await expect(
      mod.call!({ action: "site.pair", id: "site-8444" }),
    ).rejects.toThrow(/404/);

    mode = "nocode";
    const failure = await mod
      .call!({ action: "site.pair", id: "site-8444" })
      .catch((error) => String(error));
    expect(failure).toMatch(/code/i);
    expect(failure).not.toContain("secret");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("generates site blocks sorted by port, Basic Auth only when asked", () => {
  expect(
    caddySitesSnippet(
      [
        {
          id: "opencode",
          kind: "site",
          port: 8444,
          upstream: "127.0.0.1:49374",
          auth: "none",
          enabled: true,
        },
        {
          id: "admin",
          kind: "site",
          port: 9443,
          upstream: "192.168.178.9:8080",
          auth: "basic",
          enabled: false,
        },
      ],
      "home.example.net",
      "/data/caddy-users.conf",
    ),
  ).toBe(
    "# generated by iHome Caddy sites — do not edit\n\n" +
      "home.example.net:8444 {\n\treverse_proxy 127.0.0.1:49374\n}\n",
  );
  expect(
    caddySitesSnippet(
      [
        {
          id: "admin",
          kind: "site",
          port: 9443,
          upstream: "192.168.178.9:8080",
          auth: "basic",
          enabled: true,
        },
      ],
      "home.example.net",
      "/data/caddy-users.conf",
    ),
  ).toBe(
    "# generated by iHome Caddy sites — do not edit\n\n" +
      "home.example.net:9443 {\n\tbasic_auth {\n\t\timport /data/caddy-users.conf\n\t}\n\treverse_proxy 192.168.178.9:8080\n}\n",
  );
  expect(
    caddyServicesSnippet(
      [
        {
          id: "opencode",
          kind: "site",
          port: 8444,
          upstream: "127.0.0.1:49374",
          auth: "none",
          enabled: true,
        },
      ],
      "/data/caddy-users.conf",
    ),
  ).toBe("# generated by iHome Caddy services — do not edit\n");
});

it("adds a site service and writes both snippets", async () => {
  const mod = plugin({
    caddyConfig: join(dir, "Caddyfile"),
    publicUrl: "http://127.0.0.1:9/",
  });
  await writeFile(join(dir, "Caddyfile"), "x {}\n");
  const result = (await mod.call!({
    action: "services.add",
    service: {
      id: "opencode",
      kind: "site",
      port: 8444,
      upstream: "127.0.0.1:49374",
      auth: "none",
      enabled: true,
    },
  })) as { sites: { path: string; blocks: number } };
  expect(result.sites.path).toContain("caddy-sites.conf");
  const sites = await readFile(join(dir, "caddy-sites.conf"), "utf8");
  expect(sites).toContain("127.0.0.1:8444 {");
  expect(sites).not.toContain("basic_auth");
  const services = await readFile(join(dir, "caddy-services.conf"), "utf8");
  expect(services).not.toContain("8444");
});

it("refuses a site service without a public URL", async () => {
  const mod = plugin();
  await expect(
    mod.call!({
      action: "services.add",
      service: {
        id: "opencode",
        kind: "site",
        port: 8444,
        upstream: "127.0.0.1:49374",
        auth: "none",
        enabled: true,
      },
    }),
  ).rejects.toThrow(/public URL/);
  await expect(readFile(join(dir, "services.json"), "utf8")).rejects.toThrow();
});

it("reports the sites snippet and its top-level import", async () => {
  const caddyfile = join(dir, "Caddyfile");
  const sitesPath = join(dir, "caddy-sites.conf");
  await writeFile(caddyfile, `import ${sitesPath}\n`);
  const mod = plugin({
    caddyConfig: caddyfile,
    publicUrl: "http://127.0.0.1:9/",
  });
  await mod.call!({
    action: "services.add",
    service: {
      id: "opencode",
      kind: "site",
      port: 8444,
      upstream: "127.0.0.1:49374",
      auth: "none",
      enabled: true,
    },
  });
  const status = (await mod.call!({ action: "status" })) as any;
  expect(status.sitesSnippet).toMatchObject({
    exists: true,
    current: true,
    blocks: 1,
  });
  expect(status.caddy.importsSites).toBe(true);
  expect(status.services.count).toBe(1);
});

it("refuses to reload a stale sites snippet", async () => {
  const caddyfile = join(dir, "Caddyfile");
  await writeFile(caddyfile, "x {}\n");
  const mod = plugin({
    caddyConfig: caddyfile,
    publicUrl: "http://127.0.0.1:9/",
    reloadCommand: 'node -e "process.exit(0)"',
  });
  await mod.call!({
    action: "users.add",
    user: "alice",
    password: "long-enough",
  });
  await mod.call!({ action: "snippet.write" });
  await mod.call!({
    action: "services.add",
    service: {
      id: "opencode",
      kind: "site",
      port: 8444,
      upstream: "127.0.0.1:49374",
      auth: "none",
      enabled: true,
    },
  });
  await writeFile(
    join(dir, "services.json"),
    serializeServices([
      {
        id: "opencode",
        kind: "site",
        port: 8444,
        upstream: "127.0.0.1:9999",
        auth: "none",
        enabled: true,
      },
    ]),
  );
  await expect(mod.call!({ action: "caddy.reload" })).rejects.toThrow(
    /sites snippet is stale/,
  );
});
