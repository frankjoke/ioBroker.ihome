import { describe, expect, it } from "vitest";
import { validateDeviceTemplate } from "$logic/device-templates";
import {
  BUILTIN_DEVICE_TEMPLATES,
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
