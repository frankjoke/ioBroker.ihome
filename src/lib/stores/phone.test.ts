import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sent: Array<{ command: string; payload: any }> = [];
  const store = new Map<string, string>();
  const ioBroker = {
    namespace: "ihome.0",
    connected: 1,
    brokerUrl: "http://192.168.178.9:8082",
    systemConfig: { common: { latitude: 48, longitude: 16 } },
    sendTo: vi.fn(async (_instance: string, command: string, payload: any) => {
      sent.push({ command, payload });
      return { ok: true };
    }),
    states: new Map(),
    objects: new Map(),
  };
  return { sent, store, ioBroker };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }));

async function load() {
  vi.resetModules();
  return await import("./phone.svelte");
}

beforeEach(() => {
  h.sent.length = 0;
  h.store.clear();
  h.ioBroker.brokerUrl = "http://192.168.178.9:8082";
  h.ioBroker.sendTo.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => h.store.get(key) ?? null,
    setItem: (key: string, value: string) => h.store.set(key, value),
    removeItem: (key: string) => h.store.delete(key),
    clear: () => h.store.clear(),
  });
  vi.stubGlobal("navigator", {
    onLine: true,
    connection: { type: "wifi" },
    geolocation: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
  vi.stubGlobal("location", {
    hostname: "192.168.178.9",
    protocol: "https:",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates a stable device id and defaults", async () => {
  const { initPhone, phone } = await load();
  initPhone();
  const id = phone.deviceId;
  expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(phone.enabled).toBe(false);

  const again = await load();
  again.initPhone();
  expect(again.phone.deviceId).toBe(id);
});

it("reports online, connection and local state when enabled", async () => {
  const { initPhone, phone, reportPhone, setPhoneEnabled, setPhoneName } =
    await load();
  initPhone();
  setPhoneName("Kitchen");
  setPhoneEnabled(true);
  h.sent.length = 0;

  reportPhone();
  await Promise.resolve();
  await Promise.resolve();

  const update = h.sent.find((entry) => entry.payload.action === "update");
  expect(update?.payload.deviceId).toBe(phone.deviceId);
  expect(update?.payload.data).toMatchObject({
    online: true,
    connection: "wifi",
    local: true,
  });
  expect(update?.payload.data.lastSeen).toEqual(expect.any(Number));

  setPhoneEnabled(false);
});

it("does not report while disabled or paused", async () => {
  const { initPhone, pausePhone, reportPhone, setPhoneEnabled } = await load();
  initPhone();
  h.sent.length = 0;

  reportPhone();
  await Promise.resolve();
  expect(
    h.sent.filter((entry) => entry.payload.action === "update"),
  ).toHaveLength(0);

  setPhoneEnabled(true);
  pausePhone(true);
  h.sent.length = 0;
  reportPhone();
  await Promise.resolve();
  expect(
    h.sent.filter((entry) => entry.payload.action === "update"),
  ).toHaveLength(0);
  setPhoneEnabled(false);
});

it("detects a local broker and a cloud broker", async () => {
  const { isLocalBroker } = await import("./connection.svelte");
  expect(isLocalBroker()).toBe(true);

  h.ioBroker.brokerUrl = "https://iobroker.pro";
  expect(isLocalBroker()).toBe(false);
});

it("does not treat the page origin as local when it is the cloud", async () => {
  const { isLocalBroker } = await import("./connection.svelte");
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  vi.stubGlobal("location", {
    hostname: "iobroker.pro",
    protocol: "https:",
  });
  expect(isLocalBroker()).toBe(false);

  h.ioBroker.brokerUrl = "https://192.168.178.9:8082";
  expect(isLocalBroker()).toBe(true);
});

it("clears location when the fix is inside the geofence", async () => {
  const {
    initPhone,
    phone,
    requestPhoneLocation,
    setPhoneEnabled,
    setPhoneHome,
  } = await load();
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  initPhone();
  setPhoneHome({ lat: 48, lon: 16, radius: 150 });
  setPhoneEnabled(true);
  h.sent.length = 0;
  (navigator as any).geolocation.getCurrentPosition = vi.fn((ok: any) =>
    ok({
      coords: { latitude: 48.0005, longitude: 16, accuracy: 10 },
    }),
  );

  const location = await requestPhoneLocation();
  expect(location).not.toBeNull();
  await Promise.resolve();

  const update = h.sent.find((entry) => entry.payload.action === "update");
  expect(update?.payload.deviceId).toBe(phone.deviceId);
  expect(update?.payload.data).toMatchObject({
    atHome: true,
    homeSource: "geofence",
    location: null,
    locationText: "At home",
    permission: "granted",
  });
  setPhoneEnabled(false);
});

it("reports the fix when outside the geofence", async () => {
  const { initPhone, requestPhoneLocation, setPhoneEnabled, setPhoneHome } =
    await load();
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  initPhone();
  setPhoneHome({ lat: 48, lon: 16, radius: 150 });
  setPhoneEnabled(true);
  h.sent.length = 0;
  (navigator as any).geolocation.getCurrentPosition = vi.fn((ok: any) =>
    ok({
      coords: { latitude: 48.01, longitude: 16, accuracy: 20 },
    }),
  );

  await requestPhoneLocation();
  await Promise.resolve();

  const update = h.sent.find((entry) => entry.payload.action === "update");
  expect(update?.payload.data).toMatchObject({
    atHome: false,
    homeSource: "geofence",
    permission: "granted",
  });
  expect(update?.payload.data.location).toMatchObject({
    lat: 48.01,
    lon: 16,
  });
  expect(update?.payload.data.mapUrl).toContain("openstreetmap.org");
  setPhoneEnabled(false);
});

it("reports a denied permission without a location", async () => {
  const { initPhone, requestPhoneLocation, setPhoneEnabled } = await load();
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  initPhone();
  setPhoneEnabled(true);
  h.sent.length = 0;
  (navigator as any).geolocation.getCurrentPosition = vi.fn(
    (_ok: any, fail: any) => fail({ code: 1 }),
  );

  await requestPhoneLocation();
  await Promise.resolve();

  const update = h.sent.find((entry) => entry.payload.action === "update");
  expect(update?.payload.data).toMatchObject({
    atHome: null,
    homeSource: "none",
    location: null,
    permission: "denied",
  });
  setPhoneEnabled(false);
});

it("gets a fix for setting home even on the local network", async () => {
  const { getPhoneFix, initPhone, setPhoneEnabled, setPhoneHome } =
    await load();
  initPhone();
  setPhoneEnabled(true);
  setPhoneHome({ lat: 48, lon: 16, radius: 150 });
  h.sent.length = 0;
  (navigator as any).geolocation.getCurrentPosition = vi.fn((ok: any) =>
    ok({ coords: { latitude: 48.1, longitude: 16.2, accuracy: 30 } }),
  );

  const fix = await getPhoneFix();

  expect(fix).toMatchObject({ lat: 48.1, lon: 16.2 });
  expect((navigator as any).geolocation.getCurrentPosition).toHaveBeenCalled();
  expect(
    h.sent.filter((entry) => entry.payload.action === "update"),
  ).toHaveLength(0);
  setPhoneEnabled(false);
});

it("re-evaluates the geofence with the current home point", async () => {
  const {
    initPhone,
    phone,
    requestPhoneLocation,
    setPhoneEnabled,
    setPhoneHome,
  } = await load();
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  initPhone();
  setPhoneHome({ lat: 48, lon: 16, radius: 150 });
  setPhoneEnabled(true);
  h.sent.length = 0;
  let onWatch: ((position: any) => void) | null = null;
  (navigator as any).geolocation.watchPosition = vi.fn((ok: any) => {
    onWatch = ok;
    return 7;
  });
  (navigator as any).geolocation.getCurrentPosition = vi.fn((ok: any) =>
    ok({ coords: { latitude: 48.01, longitude: 16, accuracy: 20 } }),
  );

  await requestPhoneLocation();
  expect(onWatch).not.toBeNull();

  setPhoneHome({ lat: 48.01, lon: 16, radius: 150 });
  onWatch!({ coords: { latitude: 48.01, longitude: 16, accuracy: 10 } });

  expect(phone.status.atHome).toBe(true);
  expect(phone.status.homeSource).toBe("geofence");
  expect((navigator as any).geolocation.clearWatch).toHaveBeenCalledWith(7);
  setPhoneEnabled(false);
});

it("restarts the watch after a watch error", async () => {
  const { initPhone, requestPhoneLocation, setPhoneEnabled, setPhoneHome } =
    await load();
  h.ioBroker.brokerUrl = "https://iobroker.pro";
  initPhone();
  setPhoneHome({ lat: 48, lon: 16, radius: 150 });
  setPhoneEnabled(true);
  let onError: ((error: any) => void) | null = null;
  const watchPosition = vi.fn((_ok: any, fail: any) => {
    onError = fail;
    return 3;
  });
  (navigator as any).geolocation.watchPosition = watchPosition;
  (navigator as any).geolocation.getCurrentPosition = vi.fn((ok: any) =>
    ok({ coords: { latitude: 48.01, longitude: 16, accuracy: 20 } }),
  );

  await requestPhoneLocation();
  expect(watchPosition).toHaveBeenCalledTimes(1);
  onError!({ code: 2 });
  await requestPhoneLocation();

  expect(watchPosition).toHaveBeenCalledTimes(2);
  setPhoneEnabled(false);
});

it("uses the local broker as home without asking for a location", async () => {
  const { initPhone, requestPhoneLocation, setPhoneEnabled } = await load();
  initPhone();
  setPhoneEnabled(true);
  h.sent.length = 0;
  (navigator as any).geolocation.getCurrentPosition = vi.fn();

  await requestPhoneLocation();
  await Promise.resolve();

  const update = h.sent.find((entry) => entry.payload.action === "update");
  expect(update?.payload.data).toMatchObject({
    atHome: true,
    homeSource: "local",
    location: null,
  });
  expect(
    (navigator as any).geolocation.getCurrentPosition,
  ).not.toHaveBeenCalled();
  setPhoneEnabled(false);
});
