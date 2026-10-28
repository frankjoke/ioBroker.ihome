import { it, expect } from "vitest";
import {
  BLANK_DEVICE_ID,
  blankDevice,
  isBlankPlacement,
} from "$lib/config/blank-tile";

it("names the reserved id and a device with nothing on it", () => {
  expect(BLANK_DEVICE_ID).toBe("@blank");
  const d = blankDevice();
  expect(d).toMatchObject({
    id: "@blank",
    name: "",
    type: "Custom",
    controls: [],
    visibleControls: 0,
  });
  expect(Object.isFrozen(d)).toBe(true);
  expect(isBlankPlacement({ id: "t", device: "@blank" })).toBe(true);
  expect(isBlankPlacement({ id: "t", device: "dev-1" })).toBe(false);
});
