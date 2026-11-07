import { describe, expect, it } from "vitest";
import net from "node:net";
import {
  NetworkPresenceService,
  pingCommand,
  probeTcp,
  type NetworkAdapter,
} from "./network-presence";
import { presenceFromJson, type NetworkDevice } from "./logic/network-ops";

const device: NetworkDevice = {
  id: "phone",
  name: "Phone",
  host: "10.0.0.2",
  interval: 60,
  timeout: 1,
  port: 0,
};

function fakeAdapter() {
  const states = new Map<string, unknown>();
  const objects = new Map<string, unknown>();
  const adapter: NetworkAdapter = {
    namespace: "ihome.0",
    log: { debug() {}, info() {}, warn() {}, error() {} },
    setObjectNotExistsAsync: async (id, obj) => {
      if (!objects.has(id)) objects.set(id, obj);
    },
    setStateAsync: async (id, state) => {
      const value =
        typeof state === "object" && state !== null && "val" in state
          ? (state as { val: unknown }).val
          : state;
      states.set(id, value);
    },
    getStateAsync: async (id) =>
      states.has(id) ? ({ val: states.get(id) } as ioBroker.State) : null,
  };
  return { adapter, states, objects };
}

describe("NetworkPresenceService", () => {
  it("writes online, JSON and timestamps; debounces offline", async () => {
    const { adapter, states } = fakeAdapter();
    let clock = 1000;
    let online = true;
    const service = new NetworkPresenceService(
      adapter,
      [device],
      async () => online,
      () => clock,
    );

    await service.check(device);
    expect(states.get("network.phone.online")).toBe(true);
    expect(states.get("network.phone.lastConnected")).toBe(1000);
    expect(presenceFromJson(states.get("network.phone.json"))).toMatchObject({
      online: true,
      lastConnected: 1000,
      lastSeen: 1000,
    });

    clock = 2000;
    online = false;
    await service.check(device);
    expect(states.get("network.phone.online")).toBe(true);
    expect(states.get("network.phone.status")).toBe("online");

    clock = 3000;
    await service.check(device);
    expect(states.get("network.phone.online")).toBe(false);
    expect(states.get("network.phone.status")).toBe("offline");
    expect(states.get("network.phone.lastConnected")).toBe(1000);
    expect(states.get("network.phone.lastDisconnected")).toBe(3000);
    service.stop();
  });

  it("creates the JSON and individual state objects on start", async () => {
    const { adapter, objects } = fakeAdapter();
    const service = new NetworkPresenceService(
      adapter,
      [device],
      async () => true,
      () => 1000,
    );
    await service.start();
    expect(objects.has("network")).toBe(true);
    expect(objects.has("network.phone")).toBe(true);
    expect(objects.get("network.phone.json")).toMatchObject({ type: "state" });
    expect(objects.get("network.phone.online")).toMatchObject({
      type: "state",
    });
    service.stop();
  });
});

describe("probeTcp", () => {
  it("reports an open port and treats a refusal as reachable", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as net.AddressInfo).port;
    expect(await probeTcp("127.0.0.1", port, 500)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // A closed port on a reachable host answers with ECONNREFUSED: the phone
    // is up, even though nothing listens there.
    expect(await probeTcp("127.0.0.1", port, 200)).toBe(true);
  });
});

describe("pingCommand", () => {
  it("builds platform and family specific ping commands", () => {
    expect(pingCommand("192.168.1.2", 2000, "win32")).toEqual({
      file: "ping",
      args: ["-n", "1", "-w", "2000", "192.168.1.2"],
    });
    expect(pingCommand("fe80::1", 2000, "win32")).toEqual({
      file: "ping",
      args: ["-6", "-n", "1", "-w", "2000", "fe80::1"],
    });
    expect(pingCommand("fe80::1", 2000, "linux")).toEqual({
      file: "ping",
      args: ["-6", "-c", "1", "-W", "2", "fe80::1"],
    });
    expect(pingCommand("fe80::1", 2000, "darwin")).toEqual({
      file: "ping6",
      args: ["-c", "1", "-W", "2000", "fe80::1"],
    });
  });
});
