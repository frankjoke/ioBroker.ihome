import { expect, it } from "vitest";
import {
  base64ToUint8Array,
  notificationOptions,
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

it("decodes a VAPID key", () => {
  expect(base64ToUint8Array("AQID")).toEqual(new Uint8Array([1, 2, 3]));
});
