import { it, expect } from "vitest";
import { CONFIG_LAST_KEY, cogTarget } from "$lib/config/config-nav";

const IDS = ["/ui", "/devices", "/variables"];

it("cogTarget opens the UI page when nothing usable is remembered", () => {
  expect(cogTarget(null, IDS)).toBe("/ui");
  expect(cogTarget("", IDS)).toBe("/ui");
  expect(cogTarget("/nope", IDS)).toBe("/ui");
});

it("cogTarget returns the remembered config page", () => {
  expect(cogTarget("/devices", IDS)).toBe("/devices");
  expect(cogTarget("/ui", IDS)).toBe("/ui");
});

it("the session key is the documented one", () => {
  expect(CONFIG_LAST_KEY).toBe("iHome.configPage");
});
