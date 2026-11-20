import { expect, it } from "vitest";
import { PRESETS } from "./presets";

it("makes the Light preset a complete example", () => {
  const keys = PRESETS.Light.features.map((f) => f.feature);
  expect(keys).toEqual(expect.arrayContaining(["battery", "connected"]));
  expect(
    PRESETS.Light.features.find((f) => f.feature === "power")?.primary,
  ).toBe(true);
  expect(PRESETS.Light.active).toEqual({ source: "power", op: "truthy" });
  expect(PRESETS.Light.slots.some((s) => s.source === "battery")).toBe(true);
  expect(PRESETS.Light.slots.some((s) => s.source === "connected")).toBe(true);
});

it("gives every preset the connected availability badge", () => {
  for (const template of Object.values(PRESETS)) {
    expect(template.features.map((feature) => feature.feature)).toEqual(
      expect.arrayContaining(["battery", "connected"]),
    );
    expect(
      template.slots.some(
        (slot) => slot.source === "connected" && slot.options?.derive === "ago",
      ),
    ).toBe(true);
    expect(template.slots.some((slot) => slot.source === "offline")).toBe(
      false,
    );
  }
});

it("leaves dimming to the look, not the presets", () => {
  for (const template of Object.values(PRESETS)) {
    for (const slot of template.slots) {
      expect(
        slot.rules?.some((rule) => rule.disabled !== undefined) ?? false,
      ).toBe(false);
    }
  }
});
