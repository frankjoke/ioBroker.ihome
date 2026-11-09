import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { namespace: "ihome.0" },
}));
vi.mock("$lib/registry.svelte.js", () => ({ upsertDevice: vi.fn() }));
vi.mock("$lib/stores/devices.svelte", () => ({
  getCanonicalRegistry: () => ({ devices: [] }),
}));

import type { PluginView } from "$adapter/plugin-admin";
import type { PluginBundle } from "$adapter/plugin-ops";
import type { Device } from "$lib/types/device";
import {
  bundleHash,
  bundlePrefix,
  bundleStateId,
  buildPluginDevice,
  deviceBundleHash,
} from "./plugin-bundle";

const plugin = {
  id: "nut.ups",
  name: "NUT UPS",
  enabled: true,
  builtin: false,
  timeoutMs: 5000,
  debug: false,
  settings: { base: "plugins.nut.ups" },
  status: "running",
  hotSettings: false,
  hasCode: true,
  codeLength: 10,
  restartRequired: false,
  staged: false,
  removalPending: false,
} as PluginView;

const bundle: PluginBundle = {
  version: 1,
  device: {
    name: "NUT UPS",
    type: "Custom",
    controls: [
      {
        state: "battery.charge",
        feature: "value",
        label: "Battery",
        unit: "%",
      },
    ],
  },
};

describe("plugin bundles", () => {
  it("resolves relative and absolute state folders", () => {
    expect(bundlePrefix(plugin, "ihome.0")).toBe("ihome.0.plugins.nut.ups");
    expect(
      bundlePrefix(
        { ...plugin, settings: { base: "0_userdata.0.nut" } },
        "ihome.0",
      ),
    ).toBe("0_userdata.0.nut");
    expect(bundleStateId("battery.charge", "ihome.0.plugins.nut.ups")).toBe(
      "ihome.0.plugins.nut.ups.battery.charge",
    );
    expect(
      bundleStateId("0_userdata.0.nut.online", "ihome.0.plugins.nut.ups"),
    ).toBe("0_userdata.0.nut.online");
  });

  it("hashes the template so a changed bundle is detectable", () => {
    expect(bundleHash(bundle)).toBe(bundleHash(structuredClone(bundle)));
    const changed = structuredClone(bundle);
    changed.device.controls[0].label = "Charge";
    expect(bundleHash(changed)).not.toBe(bundleHash(bundle));
  });

  it("creates a tagged device from the template", () => {
    const device = buildPluginDevice(plugin, bundle, "ihome.0");
    expect(device).toMatchObject({
      name: "NUT UPS",
      type: "Custom",
    });
    expect(device.tags).toContain("plugin:nut.ups");
    expect(device.tags).toContain(`bundle:${bundleHash(bundle)}`);
    expect(device.controls[0]).toMatchObject({
      feature: "value",
      stateId: "ihome.0.plugins.nut.ups.battery.charge",
      label: "Battery",
      unit: "%",
    });
  });

  it("reuses existing control ids and keeps user extras on update", () => {
    const existing = {
      id: "device-1",
      name: "My UPS",
      type: "Custom",
      tags: ["plugin:nut.ups", "bundle:old"],
      controls: [
        {
          id: "control-1",
          feature: "value",
          stateId: "ihome.0.plugins.nut.ups.battery.charge",
          label: "Old label",
          writable: false,
          history: { duration: 1, durationUnit: "days" },
        },
      ],
    } as Device;
    const device = buildPluginDevice(plugin, bundle, "ihome.0", existing);
    expect(device.id).toBe("device-1");
    expect(device.name).toBe("My UPS");
    expect(device.tags).not.toContain("bundle:old");
    expect(device.tags).toContain(`bundle:${bundleHash(bundle)}`);
    expect(device.controls[0].id).toBe("control-1");
    expect(device.controls[0].label).toBe("Battery");
    expect(device.controls[0].history).toEqual({
      duration: 1,
      durationUnit: "days",
    });
    expect(deviceBundleHash(device)).toBe(bundleHash(bundle));
  });
});
