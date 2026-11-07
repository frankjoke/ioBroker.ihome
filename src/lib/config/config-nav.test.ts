import { it, expect } from "vitest";
import {
  CONFIG_LAST_KEY,
  cogTarget,
  templateKind,
} from "$lib/config/config-nav";

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

it("cogTarget maps the old formula page to Templates", () => {
  expect(cogTarget("/formulas", [...IDS, "/templates"])).toBe("/templates");
  expect(cogTarget("/formulas", IDS)).toBe("/ui");
});

it("the session key is the documented one", () => {
  expect(CONFIG_LAST_KEY).toBe("iHome.configPage");
});

it("maps template deep links to the two groups", () => {
  expect(templateKind("code")).toBe("code");
  expect(templateKind("templates")).toBe("templates");
  expect(templateKind("formula")).toBe("code");
  expect(templateKind("function")).toBe("code");
  expect(templateKind("device")).toBe("templates");
  expect(templateKind("logic")).toBe("templates");
  expect(templateKind("logic-device")).toBe("templates");
  expect(templateKind(null)).toBe("templates");
  expect(templateKind("nope")).toBe("templates");
});
