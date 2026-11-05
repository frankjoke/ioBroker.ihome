import { expect, it } from "vitest";
import {
  normalizePushPayload,
  sendPushes,
  shouldDropSubscription,
  upsertPushSubscription,
  validPushPayload,
  validPushSubscription,
} from "./push-ops";

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
