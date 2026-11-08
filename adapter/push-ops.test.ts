import { expect, it, vi } from "vitest";
import {
  ensureVapidKeys,
  normalizePushPayload,
  pushStatePayload,
  removePushSubscription,
  sendPushes,
  shouldDropSubscription,
  upsertPushSubscription,
  validPushPayload,
  validPushSubscription,
} from "./push-ops";

const VAPID = {
  publicKey:
    "BKHrFtP7Q0yhvGhUDFUJirKiagKv3dEpmZjKZpUBNDwiapm0y-KEbU3OGgUAXFrxEDZtra4ZVb0OfJwnN6DrPVk",
  privateKey: "Wu4EOM26dyHvMA3_jW7GaLRIjeuuAlLTQJZdemuI1WY",
};

it("accepts a valid subscription and rejects junk", () => {
  const sub = {
    deviceId: "phone-1",
    endpoint: "https://push.example/1",
    keys: { p256dh: "a", auth: "b" },
    ts: 1,
  };
  expect(validPushSubscription(sub)).toMatchObject({ deviceId: "phone-1" });
  expect(validPushSubscription({ ...sub, deviceId: "a.b" })).toBeNull();
  expect(validPushSubscription({ ...sub, endpoint: "" })).toBeNull();
});

it("drops only gone subscriptions", () => {
  expect(shouldDropSubscription(404)).toBe(true);
  expect(shouldDropSubscription(410)).toBe(true);
  expect(shouldDropSubscription(500)).toBe(false);
});

it("keeps valid VAPID keys and generates missing ones", () => {
  const generate = vi.fn(() => VAPID);
  expect(ensureVapidKeys(VAPID.publicKey, VAPID.privateKey, generate)).toEqual({
    ...VAPID,
    generated: false,
  });
  expect(generate).not.toHaveBeenCalled();
  expect(ensureVapidKeys("", "", generate)).toEqual({
    ...VAPID,
    generated: true,
  });
  expect(ensureVapidKeys(VAPID.publicKey, "garbage", generate)).toEqual({
    ...VAPID,
    generated: true,
  });
  expect(
    ensureVapidKeys("", "", () => ({ publicKey: "bad", privateKey: "bad" })),
  ).toBeNull();
});

it("normalizes long logic notifications instead of dropping them", () => {
  const payload = normalizePushPayload({
    title: "x".repeat(100),
    body: "y".repeat(400),
    level: "warning",
  });
  expect(payload.title).toHaveLength(80);
  expect(payload.body).toHaveLength(300);
  expect(payload.level).toBe("warn");
  expect(normalizePushPayload({ title: "  ", body: "b" })).toMatchObject({
    title: "iHome",
    body: "b",
  });
});

it("turns a written text state into a push message", () => {
  // One line: the app title, the line as the body.
  expect(pushStatePayload("Pump is dry")).toEqual({
    title: "iHome",
    body: "Pump is dry",
    level: "info",
  });
  // Two or more lines: the first is the title, the rest the body.
  expect(pushStatePayload("Waschmaschine\nFertig")).toEqual({
    title: "Waschmaschine",
    body: "Fertig",
    level: "info",
  });
  expect(pushStatePayload("Alarm\r\nDoor\r\nopen")).toEqual({
    title: "Alarm",
    body: "Door\nopen",
    level: "info",
  });
  expect(pushStatePayload("")).toBeNull();
  expect(pushStatePayload("   ")).toBeNull();
  expect(pushStatePayload(42)).toBeNull();
});

it("replaces a subscription by device id and endpoint", () => {
  const first = {
    deviceId: "phone-1",
    endpoint: "https://push.example/1",
    keys: { p256dh: "a", auth: "b" },
    ts: 1,
  };
  const second = { ...first, deviceId: "phone-2" };
  expect(
    upsertPushSubscription([first], {
      ...first,
      endpoint: "https://push.example/3",
    }),
  ).toHaveLength(1);
  expect(upsertPushSubscription([first], second)).toEqual([second]);
});

it("removes a subscription by device id", () => {
  const first = {
    deviceId: "phone-1",
    endpoint: "https://push.example/1",
    keys: { p256dh: "a", auth: "b" },
    ts: 1,
  };
  expect(removePushSubscription([first], "phone-1")).toEqual([]);
  expect(removePushSubscription([first], "phone-2")).toEqual([first]);
});

it("drops only gone subscriptions while sending", async () => {
  const first = {
    deviceId: "ok",
    endpoint: "https://push.example/1",
    keys: { p256dh: "a", auth: "b" },
    ts: 1,
  };
  const gone = { ...first, deviceId: "gone" };
  const down = { ...first, deviceId: "down" };
  const result = await sendPushes(
    [first, gone, down],
    { title: "Alarm", body: "Pump", level: "error" },
    async (entry) => {
      if (entry.deviceId === "gone") {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
      if (entry.deviceId === "down") {
        throw Object.assign(new Error("down"), { statusCode: 500 });
      }
    },
  );
  expect(result.sent).toBe(1);
  expect(result.removed).toBe(1);
  expect(result.subscriptions.map((entry) => entry.deviceId)).toEqual([
    "ok",
    "down",
  ]);
  expect(result.errors).toEqual([
    { deviceId: "down", statusCode: 500, error: "Error: down" },
  ]);
});

it("validates and normalizes a payload", () => {
  expect(
    validPushPayload({ title: "Alarm", body: "Pump", level: "warning" }),
  ).toMatchObject({ level: "warn" });
  expect(validPushPayload({ body: "no title" })).toBeNull();
  expect(
    validPushPayload({ title: "Alarm", body: "Pump", showBody: true }),
  ).toMatchObject({ showBody: true });
});
