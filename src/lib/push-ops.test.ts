import { expect, it } from "vitest";
import {
  base64ToUint8Array,
  notificationOptions,
  notificationTarget,
  notificationTitle,
  parsePushMessage,
} from "./push-ops";

it("parses a push payload and builds notification options", () => {
  const message = parsePushMessage({
    title: "Alarm",
    body: "Pump",
    level: "error",
    url: "/#/logic",
  });
  expect(message).toMatchObject({ level: "error" });
  expect(notificationTitle(message!)).toBe("iHome");
  expect(notificationOptions(message!)).toMatchObject({
    body: "New notification",
    requireInteraction: true,
    data: { url: "/#/logic" },
  });
  expect(notificationTitle({ ...message!, showBody: true })).toBe("Alarm");
  expect(notificationOptions({ ...message!, showBody: true })).toMatchObject({
    body: "Pump",
  });
});

it("defaults the click target to the app scope", () => {
  const message = parsePushMessage({ title: "Alarm", body: "Pump" })!;
  expect(notificationOptions(message).data).toEqual({ url: "" });
});

it("resolves click targets inside the app and rejects other origins", () => {
  const scope = "https://host/ihome/";
  expect(notificationTarget(undefined, scope)).toBe(scope);
  expect(notificationTarget("/#/logic", scope)).toBe(`${scope}#/logic`);
  expect(notificationTarget("https://evil.example/x", scope)).toBe(scope);
});

it("decodes a VAPID key", () => {
  expect(base64ToUint8Array("AQID")).toEqual(new Uint8Array([1, 2, 3]));
});
