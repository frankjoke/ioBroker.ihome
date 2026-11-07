import { describe, expect, it } from "vitest";
import { magicPacket, sendWake, wakeTargets } from "./wake-on-lan";

describe("magicPacket", () => {
  it("builds the 102-byte magic packet", () => {
    const packet = magicPacket("cc:b1:1a:72:c6:bc");
    expect(packet).toHaveLength(102);
    expect([...packet.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...packet.subarray(6, 12)]).toEqual([
      0xcc, 0xb1, 0x1a, 0x72, 0xc6, 0xbc,
    ]);
    expect(() => magicPacket("cc:b1:1a")).toThrow("invalid MAC");
  });
});

describe("wakeTargets", () => {
  it("builds IPv4 and hostname targets and rejects IPv6", () => {
    expect(wakeTargets("192.168.178.23")).toEqual([
      "192.168.178.255",
      "192.168.178.23",
    ]);
    expect(wakeTargets("tv.local")).toEqual(["255.255.255.255", "tv.local"]);
    expect(() => wakeTargets("fe80::1")).toThrow("IPv4");
  });
});

describe("sendWake", () => {
  it("sends the packet to both targets on port 9 and clamps the port", async () => {
    const calls: unknown[] = [];
    const result = await sendWake(
      { host: "192.168.178.23", mac: "cc:b1:1a:72:c6:bc" },
      async (packet, port, targets) => calls.push({ packet, port, targets }),
    );
    expect(result).toEqual({
      host: "192.168.178.23",
      port: 9,
      targets: ["192.168.178.255", "192.168.178.23"],
    });
    expect(calls).toHaveLength(1);
    expect(
      (
        await sendWake(
          { host: "192.168.178.23", mac: "cc:b1:1a:72:c6:bc", port: 0 },
          async () => {},
        )
      ).port,
    ).toBe(1);
    expect(
      (
        await sendWake(
          {
            host: "192.168.178.23",
            mac: "cc:b1:1a:72:c6:bc",
            port: 99_999,
          },
          async () => {},
        )
      ).port,
    ).toBe(65_535);
  });

  it("propagates a sender error", async () => {
    await expect(
      sendWake(
        { host: "192.168.178.23", mac: "cc:b1:1a:72:c6:bc" },
        async () => {
          throw new Error("send failed");
        },
      ),
    ).rejects.toThrow("send failed");
  });
});
