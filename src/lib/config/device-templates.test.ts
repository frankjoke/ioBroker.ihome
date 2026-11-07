import { describe, expect, it } from "vitest";
import { validateDeviceTemplate } from "$logic/device-templates";
import {
  BUILTIN_DEVICE_TEMPLATES,
  deviceTemplateProblem,
  evaluateDeviceTemplate,
} from "./device-templates";

describe("built-in device templates", () => {
  it("evaluates and validates every built-in", () => {
    for (const entry of BUILTIN_DEVICE_TEMPLATES) {
      const value = evaluateDeviceTemplate(entry.source);
      expect(validateDeviceTemplate(value).errors).toEqual([]);
    }
  });

  it("has unique ids", () => {
    const ids = BUILTIN_DEVICE_TEMPLATES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

it("ships a state-sourced Meter template", () => {
  const entry = BUILTIN_DEVICE_TEMPLATES.find(
    (template) => template.id === "shrdzm-mqtt-meter",
  );
  expect(entry).toBeDefined();
  const value = evaluateDeviceTemplate(entry!.source) as {
    readFrom?: string;
    deviceType?: string;
    itemList: Array<{ source?: string | Array<string | number> }>;
  };
  expect(value.readFrom).toBe("state");
  expect(value.deviceType).toBe("Meter");
  expect(value.itemList.some((item) => item.source?.[0] === "1.8.0")).toBe(
    true,
  );
});

it("checks an API template by evaluating its source", () => {
  for (const entry of BUILTIN_DEVICE_TEMPLATES) {
    expect(deviceTemplateProblem(entry)).toBeNull();
  }
  expect(
    deviceTemplateProblem({ ...BUILTIN_DEVICE_TEMPLATES[0], id: "" }),
  ).toMatch(/id/i);
  expect(
    deviceTemplateProblem({ ...BUILTIN_DEVICE_TEMPLATES[0], source: "1 +" }),
  ).toBeTruthy();
  expect(
    deviceTemplateProblem({ ...BUILTIN_DEVICE_TEMPLATES[0], source: "({})" }),
  ).toMatch(/itemList/i);
});
