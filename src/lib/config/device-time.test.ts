import { it, expect } from "vitest";
import { deviceTimestamp } from "$lib/config/device-time";

const old = 1_000_000_000_000;
const newer = old + 60_000;

it("uses the lastSeen value over a fresh state timestamp", () => {
  expect(
    deviceTimestamp(
      [{ id: "lastSeen", label: "Last seen", liveValue: old }],
      () => newer,
    ),
  ).toBe(old);
});

it("falls back from lastSeen to lastConnected", () => {
  expect(
    deviceTimestamp(
      [
        { id: "lastConnected", label: "Last connected", liveValue: old },
        { id: "online", stateId: "x.online" },
      ],
      () => newer,
    ),
  ).toBe(old);
});

it("uses any value.time control when neither name is present", () => {
  expect(
    deviceTimestamp(
      [{ id: "stamp", liveValue: old, meta: { role: "value.time" } }],
      () => newer,
    ),
  ).toBe(old);
});

it("accepts numeric and ISO strings", () => {
  const iso = new Date(old).toISOString();
  expect(
    deviceTimestamp([{ id: "lastSeen", liveValue: String(old) }], () => newer),
  ).toBe(old);
  expect(
    deviceTimestamp([{ id: "lastSeen", liveValue: iso }], () => newer),
  ).toBe(old);
});

it("ignores never/unreadable values and falls back to the newest state ts", () => {
  const newer2 = newer + 60_000;
  expect(
    deviceTimestamp(
      [
        { id: "lastSeen", liveValue: 0 },
        { id: "lastConnected", liveValue: "abc" },
        { id: "a", stateId: "x.a" },
        { id: "b", stateId: "x.b" },
      ],
      (id) => (id === "x.a" ? old : newer2),
    ),
  ).toBe(newer2);
});
