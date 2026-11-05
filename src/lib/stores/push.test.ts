import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sent: Array<{ command: string; payload: any }> = [];
  const states = new Map<string, { val: unknown }>();
  const subscription = {
    toJSON: () => ({
      endpoint: "https://push.example/1",
      keys: { p256dh: "a", auth: "b" },
    }),
    unsubscribe: vi.fn(async () => true),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => null as unknown),
    subscribe: vi.fn(async () => subscription),
  };
  const registration = { pushManager };
  const notification = {
    permission: "default",
    requestPermission: vi.fn(async () => "granted"),
  };
  const ioBroker = {
    namespace: "ihome.0",
    connected: true,
    states,
    sendTo: vi.fn(async (_instance: string, command: string, payload: any) => {
      sent.push({ command, payload });
      return { ok: true };
    }),
  };
  return {
    sent,
    states,
    subscription,
    pushManager,
    registration,
    notification,
    ioBroker,
  };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }));
vi.mock("$lib/stores/devices.svelte", () => ({
  registerProgramStateId: vi.fn(),
}));
vi.mock("$lib/stores/phone.svelte", () => ({
  phone: { deviceId: "phone-1", name: "Kitchen" },
}));

async function load() {
  vi.resetModules();
  return await import("./push.svelte");
}

function installSupport() {
  h.pushManager.getSubscription.mockResolvedValue(null);
  h.pushManager.subscribe.mockResolvedValue(h.subscription);
  h.notification.permission = "default";
  h.notification.requestPermission.mockResolvedValue("granted");
  h.subscription.unsubscribe.mockResolvedValue(true);
  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve(h.registration) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", h.notification);
}

beforeEach(() => {
  h.sent.length = 0;
  h.states.clear();
  h.states.set("ihome.0.info.pushPublicKey", { val: "AQID" });
  h.ioBroker.sendTo.mockClear();
  h.pushManager.getSubscription.mockReset();
  h.pushManager.subscribe.mockReset();
  h.notification.requestPermission.mockReset();
  h.subscription.unsubscribe.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("marks push unsupported without a service worker or PushManager", async () => {
  const { initPush, push } = await load();
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("PushManager", undefined);
  vi.stubGlobal("Notification", undefined);

  initPush();

  expect(push.supported).toBe(false);
});

it("enables push and sends the subscription to the adapter", async () => {
  installSupport();
  const { enablePush, initPush, push } = await load();
  initPush();
  await Promise.resolve();

  await enablePush();

  expect(h.notification.requestPermission).toHaveBeenCalled();
  expect(h.pushManager.subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array([1, 2, 3]),
  });
  expect(h.sent).toContainEqual({
    command: "push",
    payload: {
      action: "subscribe",
      deviceId: "phone-1",
      name: "Kitchen",
      subscription: {
        endpoint: "https://push.example/1",
        keys: { p256dh: "a", auth: "b" },
      },
    },
  });
  expect(push.subscribed).toBe(true);
  expect(push.error).toBe("");
});

it("disables push and removes the subscription", async () => {
  installSupport();
  h.pushManager.getSubscription.mockResolvedValue(h.subscription);
  const { disablePush, initPush, push } = await load();
  initPush();
  await Promise.resolve();

  await disablePush();

  expect(h.subscription.unsubscribe).toHaveBeenCalled();
  expect(h.sent).toContainEqual({
    command: "push",
    payload: { action: "unsubscribe", deviceId: "phone-1" },
  });
  expect(push.subscribed).toBe(false);
});

it("does not subscribe when permission is denied", async () => {
  installSupport();
  h.notification.requestPermission.mockResolvedValue("denied");
  const { enablePush, initPush, push } = await load();
  initPush();
  await Promise.resolve();

  await enablePush();

  expect(h.pushManager.subscribe).not.toHaveBeenCalled();
  expect(h.sent).toHaveLength(0);
  expect(push.permission).toBe("denied");
  expect(push.error).not.toBe("");
});
