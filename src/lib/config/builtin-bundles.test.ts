import { describe, expect, it } from "vitest";
import { bundleApplyParts } from "$lib/config/template-apply";
import { templateBundleProblem } from "$lib/config/template-bundles";
import { BUILTIN_BUNDLES } from "./builtin-bundles";
import { evaluateBundleApi } from "./template-bundles";
import { validateDeviceTemplate } from "$logic/device-templates";

describe("built-in bundles", () => {
  it("are valid and self-contained", () => {
    for (const bundle of BUILTIN_BUNDLES) {
      expect(templateBundleProblem(bundle, [], [], bundle.id)).toBeNull();
    }
  });

  it("network device maps the adapter JSON into items", () => {
    const bundle = BUILTIN_BUNDLES.find(
      (entry) => entry.id === "network-device",
    )!;
    expect(bundle).toBeDefined();
    expect(bundleApplyParts(bundle)).toEqual(["api", "device"]);
    expect(bundle.items?.map((item) => [item.name, item.source])).toEqual([
      ["online", "online"],
      ["lastConnected", "lastConnected"],
      ["lastDisconnected", "lastDisconnected"],
      ["lastSeen", "lastSeen"],
    ]);
    expect(bundle.params?.[0]).toMatchObject({
      name: "source",
      type: "state",
    });
    expect(bundle.params?.[0]?.description?.trim()).toBeTruthy();
    const shape = evaluateBundleApi(bundle);
    expect(validateDeviceTemplate(shape).errors).toEqual([]);
  });

  it("ships the Samsung remote as a Device-only bundle", () => {
    const bundle = BUILTIN_BUNDLES.find(
      (entry) => entry.id === "samsung-tv-remote",
    );
    expect(bundle).toBeDefined();
    expect(bundleApplyParts(bundle!)).toEqual(["device"]);
    expect(bundle!.params?.[0]).toMatchObject({
      name: "wakeDevice",
      type: "string",
    });
    const html = String(bundle!.device?.slots?.[0]?.options?.html);
    expect(html).toContain('ihome.call("network.info"');
    expect(html).toContain('ihome.call("network.wake"');
    expect(html).toContain("{{wakeDevice}}");
    expect(html).not.toContain('fetch("/wake")');
    expect(html).not.toMatch(/192\.168\.\d+\.\d+/);
    expect(html).not.toMatch(/[0-9a-f]{2}(:[0-9a-f]{2}){5}/i);
  });
});
