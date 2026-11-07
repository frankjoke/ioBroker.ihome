import { describe, expect, it } from "vitest";
import {
  initialPresence,
  nextPresence,
  presenceFromJson,
  presenceJsonValue,
  validNetworkDevice,
  validNetworkDevices,
} from "./network-ops";

describe("validNetworkDevice", () => {
  it("accepts IPv6 literals and still rejects unsafe hosts", () => {
    expect(
      validNetworkDevice({ id: "v6", name: "V6", host: "fe80::1" }),
    ).toMatchObject({
      host: "fe80::1",
    });
    expect(
      validNetworkDevice({ id: "v6", name: "V6", host: "2001:db8::10" }),
    ).toMatchObject({ host: "2001:db8::10" });
    expect(
      validNetworkDevice({ id: "bad", name: "Bad", host: "a:b" }),
    ).toBeNull();
    expect(
      validNetworkDevice({ id: "bad", name: "Bad", host: "-oops" }),
    ).toBeNull();
  });

  it("accepts a full entry, normalizes the MAC and clamps the numbers", () => {
    expect(
      validNetworkDevice({
        id: "phone-franz",
        name: " Franz phone ",
        host: "192.168.178.42",
        mac: "AA:BB:CC:DD:EE:FF",
        interval: 15,
        timeout: 3,
        port: 62078,
      }),
    ).toEqual({
      id: "phone-franz",
      name: "Franz phone",
      host: "192.168.178.42",
      mac: "aa:bb:cc:dd:ee:ff",
      interval: 15,
      timeout: 3,
      port: 62078,
    });
    expect(
      validNetworkDevice({ id: "x", name: "X", host: "tv.local", interval: 1 }),
    ).toMatchObject({ interval: 10, timeout: 2, port: 0 });
  });

  it("rejects unsafe ids, hosts and MACs", () => {
    expect(validNetworkDevice({ id: "a.b", name: "X", host: "x" })).toBeNull();
    expect(
      validNetworkDevice({ id: "x", name: "X", host: "-oops" }),
    ).toBeNull();
    expect(validNetworkDevice({ id: "x", name: "X", host: "a b" })).toBeNull();
    expect(
      validNetworkDevice({
        id: "x",
        name: "X",
        host: "x",
        mac: "not-a-mac",
      }),
    ).toBeNull();
    expect(validNetworkDevice({ id: "x", name: " ", host: "x" })).toBeNull();
  });

  it("keeps the first of duplicate ids and skips invalid entries", () => {
    expect(
      validNetworkDevices([
        { id: "a", name: "First", host: "10.0.0.1" },
        { id: "a", name: "Second", host: "10.0.0.2" },
        { id: "bad.id", name: "Bad", host: "10.0.0.3" },
        { id: "b", name: "B", host: "10.0.0.4" },
      ]).map((device) => `${device.id}:${device.name}`),
    ).toEqual(["a:First", "b:B"]);
    expect(validNetworkDevices("nope")).toEqual([]);
  });
});

describe("presence transitions", () => {
  it("starts unknown and records the first connection", () => {
    const initial = initialPresence();
    expect(initial.status).toBe("unknown");
    const connected = nextPresence(initial, true, 1000);
    expect(connected).toEqual({
      online: true,
      status: "online",
      failures: 0,
      lastConnected: 1000,
      lastDisconnected: 0,
      lastSeen: 1000,
    });
  });

  it("keeps lastConnected across successful checks", () => {
    const first = nextPresence(initialPresence(), true, 1000);
    const second = nextPresence(first, true, 2000);
    expect(second.lastConnected).toBe(1000);
    expect(second.lastSeen).toBe(2000);
  });

  it("debounces failures before going offline", () => {
    const online = nextPresence(initialPresence(), true, 1000);
    const firstFail = nextPresence(online, false, 3000, 2);
    expect(firstFail).toMatchObject({
      online: true,
      status: "online",
      failures: 1,
      lastDisconnected: 0,
    });
    const secondFail = nextPresence(firstFail, false, 4000, 2);
    expect(secondFail).toMatchObject({
      online: false,
      status: "offline",
      failures: 2,
      lastConnected: 1000,
      lastDisconnected: 4000,
    });
  });

  it("does not invent a disconnect time when never online", () => {
    const firstFail = nextPresence(initialPresence(), false, 3000, 2);
    expect(firstFail.status).toBe("unknown");
    const secondFail = nextPresence(firstFail, false, 4000, 2);
    expect(secondFail).toMatchObject({
      online: false,
      status: "offline",
      lastDisconnected: 0,
      lastConnected: 0,
    });
  });

  it("records a fresh connection after a disconnect", () => {
    const online = nextPresence(initialPresence(), true, 1000);
    const offline = nextPresence(
      nextPresence(online, false, 2000, 1),
      false,
      2001,
      1,
    );
    const back = nextPresence(offline, true, 5000);
    expect(back).toMatchObject({
      online: true,
      status: "online",
      failures: 0,
      lastConnected: 5000,
      lastDisconnected: 2000,
    });
  });
});

describe("presence JSON", () => {
  it("round-trips the persisted presence", () => {
    const presence = nextPresence(initialPresence(), true, 1000);
    expect(
      presenceFromJson(JSON.stringify(presenceJsonValue(presence))),
    ).toEqual(presence);
    expect(presenceFromJson(presence)).toEqual(presence);
  });

  it("returns null for junk", () => {
    expect(presenceFromJson("not json")).toBeNull();
    expect(presenceFromJson(null)).toBeNull();
    expect(presenceFromJson([])).toBeNull();
  });
});
