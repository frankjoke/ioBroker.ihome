import { describe, expect, it } from "vitest";
import { createNetworkPlugins } from "./network";
import type { PluginApi } from "../plugin-api";
import type { NetworkDevice } from "../logic/network-ops";

const tv: NetworkDevice = {
  id: "tv",
  name: "TV",
  host: "192.168.1.2",
  mac: "aa:bb:cc:dd:ee:ff",
  interval: 60,
  timeout: 2,
  port: 0,
};

function fakeNetworkApi(device: NetworkDevice = tv): PluginApi {
  const devices = [device].map(({ id, name, host, mac }) => ({
    id,
    name,
    host,
    ...(mac ? { mac } : {}),
  }));
  return {
    namespace: "ihome.0",
    config: {},
    log: { debug() {}, info() {}, warn() {}, error() {} },
    state: {
      get: async () => undefined,
      set: async () => {},
      getForeign: async () => undefined,
      setForeign: async () => {},
    },
    objects: { get: async () => undefined, getForeign: async () => undefined },
    network: {
      list: () => devices.map((entry) => ({ ...entry })),
      get: (id) => {
        const found = devices.find((entry) => entry.id === id);
        return found ? { ...found } : undefined;
      },
    },
    sendTo: async () => undefined,
  };
}

describe("createNetworkPlugins", () => {
  it("returns one device or the whole list", async () => {
    const plugins = createNetworkPlugins();
    const api = fakeNetworkApi();
    expect(await plugins["network.info"](api).call!({ id: "tv" })).toEqual({
      id: "tv",
      name: "TV",
      host: "192.168.1.2",
      mac: "aa:bb:cc:dd:ee:ff",
    });
    expect(await plugins["network.info"](api).call!({})).toEqual({
      devices: [
        {
          id: "tv",
          name: "TV",
          host: "192.168.1.2",
          mac: "aa:bb:cc:dd:ee:ff",
        },
      ],
    });
    await expect(
      plugins["network.info"](api).call!({ id: "missing" }),
    ).rejects.toThrow("unknown network device");
  });

  it("wakes a configured device and rejects missing MAC or id", async () => {
    const sent: unknown[] = [];
    const plugins = createNetworkPlugins(async (options) => {
      sent.push(options);
      return { sent: true };
    });
    const api = fakeNetworkApi();
    expect(
      await plugins["network.wake"](api).call!({ id: "tv" }),
    ).toMatchObject({ sent: true });
    expect(sent).toEqual([
      { host: "192.168.1.2", mac: "aa:bb:cc:dd:ee:ff", port: undefined },
    ]);
    await expect(plugins["network.wake"](api).call!({})).rejects.toThrow("id");
    await expect(
      plugins["network.wake"](fakeNetworkApi({ ...tv, mac: undefined })).call!({
        id: "tv",
      }),
    ).rejects.toThrow("MAC");
  });

  it("rejects a missing network device", async () => {
    const plugins = createNetworkPlugins(async () => ({ ok: true }));
    await expect(
      plugins["network.wake"](fakeNetworkApi()).call!({ id: "missing" }),
    ).rejects.toThrow("unknown network device");
  });
});
