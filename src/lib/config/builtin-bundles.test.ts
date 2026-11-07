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
    expect(bundle.params?.[0]).toMatchObject({ name: "source", type: "state" });
    const shape = evaluateBundleApi(bundle);
    expect(validateDeviceTemplate(shape).errors).toEqual([]);
  });
});
