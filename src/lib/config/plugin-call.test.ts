import { describe, expect, it, vi } from "vitest";
import { callPlugin, unwrapPluginReply } from "./plugin-call";

describe("unwrapPluginReply", () => {
  it("unwraps a successful reply and throws the error text otherwise", () => {
    expect(
      unwrapPluginReply({ ok: true, result: { host: "1.2.3.4" } }),
    ).toEqual({ host: "1.2.3.4" });
    expect(() => unwrapPluginReply({ ok: false, error: "nope" })).toThrow(
      "nope",
    );
    expect(() => unwrapPluginReply(null)).toThrow("plugin call failed");
  });
});

describe("callPlugin", () => {
  it("sends the plugin command through the namespace", async () => {
    const send = vi.fn(async () => ({ ok: true, result: 7 }));
    expect(
      await callPlugin(send, "ihome.0", "network.info", { id: "tv" }),
    ).toBe(7);
    expect(send).toHaveBeenCalledWith("ihome.0", "plugin", {
      id: "network.info",
      payload: { id: "tv" },
    });
  });

  it("rejects with the plugin error", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "unknown" }));
    await expect(
      callPlugin(send, "ihome.0", "network.wake", undefined),
    ).rejects.toThrow("unknown");
  });
});
