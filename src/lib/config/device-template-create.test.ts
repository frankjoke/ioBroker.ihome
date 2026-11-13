import { expect, it } from "vitest";
import { planDeviceCreate } from "./device-template-create";
import { PRESETS } from "./template-ops";
import type { Template } from "$lib/types/display";

function fill(feature: string, ref: string, object: any) {
  return { feature, ref, stateId: ref, object };
}

const base = {
  template: PRESETS.Light,
  name: "Lamp",
  fills: [],
  newId: () => "d1",
  newControlId: () => "c1",
};

it("builds a device with filled controls and the template id", () => {
  const plan = planDeviceCreate({
    ...base,
    room: "enum.rooms.Bad",
    fills: [
      fill("power", "hue.on", {
        common: { type: "boolean", write: true },
      }),
    ],
  });
  expect("device" in plan && plan.device).toMatchObject({
    id: "d1",
    name: "Lamp",
    type: "Light",
    template: "Light",
    room: "enum.rooms.Bad",
    controls: [
      {
        id: "c1",
        feature: "power",
        stateId: "hue.on",
        writable: true,
      },
    ],
  });
});

it("stores a variable name as the reference", () => {
  const plan = planDeviceCreate({
    ...base,
    fills: [fill("power", "wifiSsid", { common: { write: false } })],
  });
  expect("device" in plan && plan.device.controls[0].stateId).toBe("wifiSsid");
});

it("blocks a missing required feature and ignores optional omissions", () => {
  const required: Template = {
    ...PRESETS.Light,
    features: PRESETS.Light.features.map((feature) =>
      feature.feature === "power" ? { ...feature, required: true } : feature,
    ),
  };
  expect(planDeviceCreate({ ...base, template: required, fills: [] })).toEqual({
    problem: "Power is required.",
  });
});

it("rejects unknown and duplicate fills", () => {
  expect(
    planDeviceCreate({ ...base, fills: [fill("nope", "x", {})] }),
  ).toHaveProperty("problem");
  expect(
    planDeviceCreate({
      ...base,
      fills: [fill("power", "a", {}), fill("power", "b", {})],
    }),
  ).toHaveProperty("problem");
});
