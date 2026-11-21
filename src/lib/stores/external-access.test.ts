import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const replies: Record<string, unknown> = {};
  const send = vi.fn(
    async (_ns: string, _cmd: string, payload: unknown): Promise<unknown> => {
      const action = (payload as { payload?: { action?: string } } | undefined)
        ?.payload?.action;
      return {
        ok: true,
        result: replies[action ?? ""] ?? { users: [] },
      };
    },
  );
  return { replies, send };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { namespace: "ihome.0", sendTo: h.send },
}));

beforeEach(() => {
  for (const key of Object.keys(h.replies)) delete h.replies[key];
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
