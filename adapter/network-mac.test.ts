import { describe, expect, it } from "vitest";
import { discoverMac, macFromOutput, neighborMac } from "./network-mac";

describe("macFromOutput", () => {
  it("reads Linux, Windows and macOS neighbour lines", () => {
    expect(
      macFromOutput(
        "192.168.178.25 dev wlan0 lladdr AA:BB:CC:DD:EE:FF REACHABLE",
      ),
    ).toBe("aa:bb:cc:dd:ee:ff");
    expect(
      macFromOutput("  192.168.178.25       aa-bb-cc-dd-ee-ff     dynamic"),
    ).toBe("aa:bb:cc:dd:ee:ff");
    expect(
      macFromOutput(
        "? (192.168.1.5) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
      ),
    ).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("ignores an unknown or all-zero entry", () => {
    expect(macFromOutput("192.168.178.25 dev wlan0  FAILED")).toBeUndefined();
    expect(
      macFromOutput("192.168.178.25 dev wlan0 lladdr 00:00:00:00:00:00 STALE"),
    ).toBeUndefined();
    expect(
      macFromOutput("(incomplete) 192.168.178.25 dev wlan0 INCOMPLETE"),
    ).toBeUndefined();
  });
});

describe("neighborMac", () => {
  it("uses the platform's neighbour command", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const run = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return "192.168.178.25 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE";
    };
    expect(await neighborMac("192.168.178.25", "linux", run)).toBe(
      "aa:bb:cc:dd:ee:ff",
    );
    expect(calls[0]).toEqual({
      file: "ip",
      args: ["neigh", "show", "192.168.178.25"],
    });
    await neighborMac("192.168.178.25", "win32", run);
    expect(calls[1]).toEqual({
      file: "arp",
      args: ["-a", "192.168.178.25"],
    });
  });
});

describe("discoverMac", () => {
  it("probes once when the table has no entry yet", async () => {
    const outputs = [
      "",
      "192.168.178.25 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE",
    ];
    let probes = 0;
    const run = async () => outputs.shift() ?? "";
    expect(
      await discoverMac("192.168.178.25", {
        platform: "linux",
        run,
        probeHost: async () => {
          probes += 1;
        },
      }),
    ).toBe("aa:bb:cc:dd:ee:ff");
    expect(probes).toBe(1);
  });

  it("returns undefined when the table stays empty", async () => {
    expect(
      await discoverMac("192.168.178.25", {
        platform: "linux",
        run: async () => "",
        probeHost: async () => {},
      }),
    ).toBeUndefined();
  });
});
