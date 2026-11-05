import { expect, it } from "vitest";
import {
  shouldDropSubscription,
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

it("validates and normalizes a payload", () => {
  expect(
    validPushPayload({ title: "Alarm", body: "Pump", level: "warning" }),
  ).toMatchObject({ level: "warn" });
  expect(validPushPayload({ body: "no title" })).toBeNull();
  expect(
    validPushPayload({ title: "Alarm", body: "Pump", showBody: true }),
  ).toMatchObject({ showBody: true });
});
