import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const replies: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const pluginViews: { id: string; settings?: Record<string, unknown> }[] = [];
  const savePlugin = vi.fn(async (patch?: unknown) => patch);
  const send = vi.fn(
    async (_ns: string, _cmd: string, payload: unknown): Promise<unknown> => {
      const action = (payload as { payload?: { action?: string } } | undefined)
        ?.payload?.action;
      if (errors[action ?? ""]) {
        return { ok: false, error: errors[action ?? ""] };
      }
      return {
        ok: true,
        result: replies[action ?? ""] ?? { users: [] },
      };
    },
  );
  return { replies, errors, pluginViews, savePlugin, send };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { namespace: "ihome.0", sendTo: h.send },
}));

vi.mock("$lib/stores/plugins.svelte", () => ({
  getPlugins: () => h.pluginViews,
  loadPlugins: async () => {},
  savePlugin: h.savePlugin,
}));

beforeEach(() => {
  for (const key of Object.keys(h.replies)) delete h.replies[key];
  for (const key of Object.keys(h.errors)) delete h.errors[key];
  h.pluginViews.length = 0;
  h.savePlugin.mockClear();
  h.send.mockClear();
  vi.resetModules();
});

async function store() {
  return import("./external-access.svelte");
}

it("loads status and users through the plugin command", async () => {
  h.replies["status"] = { folder: { path: "/x", writable: true } };
  h.replies["users.list"] = { users: [{ user: "alice", enabled: true }] };
  const s = await store();
  await s.loadExternalAccess();
  expect(h.send).toHaveBeenCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "users.list" },
  });
  expect(s.getExternalUsers()).toEqual([{ user: "alice", enabled: true }]);
  expect(s.getExternalStatus()).toMatchObject({ folder: { writable: true } });
});

it("maps mutations to their actions and refreshes the list", async () => {
  h.replies["users.add"] = { users: [{ user: "bob", enabled: true }] };
  h.replies["snippet.write"] = {
    path: "/x/caddy-users.conf",
    count: 1,
    changed: true,
  };
  const s = await store();
  await s.addExternalUser("bob", "long-enough", "Guest");
  expect(h.send).toHaveBeenLastCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: {
      action: "users.add",
      user: "bob",
      password: "long-enough",
      note: "Guest",
    },
  });
  expect(s.getExternalUsers().map((u) => u.user)).toEqual(["bob"]);
  await s.writeExternalSnippet();
  expect(h.send).toHaveBeenLastCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "snippet.write" },
  });
  expect(s.getExternalSnippet()).toMatchObject({ changed: true });
});

it("surfaces a plugin error as the problem text", async () => {
  h.send.mockImplementationOnce(async () => ({
    ok: false,
    error: "caddy missing",
  }));
  const s = await store();
  await expect(s.validateExternalCaddy()).rejects.toThrow("caddy missing");
  expect(s.getExternalProblem()).toBe("caddy missing");
});

it("refreshes the status after a toggle or removal", async () => {
  h.replies["users.remove"] = { users: [] };
  h.replies["status"] = { snippet: { current: false } };
  const s = await store();
  await s.removeExternalUser("alice");
  expect(h.send).toHaveBeenLastCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "status" },
  });
  expect(s.getExternalStatus()).toMatchObject({ snippet: { current: false } });
});

it("loads services with status and users", async () => {
  h.replies["services.list"] = {
    services: [
      {
        id: "a",
        kind: "proxy",
        path: "/a",
        upstream: "127.0.0.1:1",
        auth: "basic",
        enabled: true,
      },
    ],
  };
  const s = await store();
  await s.loadExternalAccess();
  expect(h.send).toHaveBeenCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "services.list" },
  });
  expect(s.getExternalServices().map((row) => row.path)).toEqual(["/a"]);
});

it("maps service mutations and refreshes the status", async () => {
  const service = {
    id: "a",
    kind: "proxy" as const,
    path: "/a",
    upstream: "127.0.0.1:1",
    auth: "basic" as const,
    enabled: true,
  };
  h.replies["services.add"] = {
    services: [service],
    snippet: { changed: true },
  };
  const s = await store();
  await s.addExternalService(service);
  expect(h.send).toHaveBeenCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "services.add", service },
  });
  await s.setExternalServiceEnabled("a", false);
  expect(h.send).toHaveBeenCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: {
      action: "services.update",
      service: { ...service, enabled: false },
    },
  });
  expect(h.send).toHaveBeenLastCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "status" },
  });
  await s.removeExternalService("a");
  expect(h.send).toHaveBeenCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "services.remove", id: "a" },
  });
});

it("rotates an http.in endpoint token explicitly", async () => {
  h.pluginViews.push({
    id: "http.in",
    settings: {
      endpoints: JSON.stringify([
        { path: "phone-event", method: "GET", token: "old", reply: "ok" },
      ]),
      token: "global",
      port: 3000,
    },
  });
  const s = await store();
  const token = await s.rotateWebhookToken("/phone-event");
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  const patch = h.savePlugin.mock.calls[0][0] as {
    settings: Record<string, unknown>;
  };
  expect(Array.isArray(patch.settings.endpoints)).toBe(true);
  const endpoints = patch.settings.endpoints as {
    path: string;
    token: string;
    reply?: string;
  }[];
  expect(endpoints[0]).toMatchObject({
    path: "phone-event",
    token,
    reply: "ok",
  });
  expect(h.savePlugin).toHaveBeenCalledWith({
    id: "http.in",
    settings: { endpoints, token: "global", port: 3000 },
  });
});

it("creates a site pairing through the plugin action", async () => {
  h.replies["site.pair"] = {
    external: "https://home.example.net:8444/auth/connect/ABC",
    internal: "http://192.168.1.5:49374/auth/connect/ABC",
    expiresIn: 300,
  };
  const s = await store();
  await expect(s.createSitePairing("site-8444")).resolves.toEqual(
    h.replies["site.pair"],
  );
  expect(h.send).toHaveBeenLastCalledWith("ihome.0", "plugin", {
    id: "external-access",
    payload: { action: "site.pair", id: "site-8444" },
  });
});

it("surfaces a pairing failure as the card problem", async () => {
  h.errors["site.pair"] = "Read the OpenCode password from /x.";
  const s = await store();
  await expect(s.createSitePairing("site-8444")).rejects.toThrow(
    /OpenCode password/,
  );
  expect(s.getExternalProblem()).toMatch(/OpenCode password/);
});

it("builds public links with the right shape", async () => {
  const s = await store();
  expect(
    s.webhookLink("https://home.example.net/", "/phone-event", "abc"),
  ).toBe("https://home.example.net/phone-event?token=abc");
  expect(s.proxyLink("https://home.example.net/", "/opencode")).toBe(
    "https://home.example.net/opencode/",
  );
});
