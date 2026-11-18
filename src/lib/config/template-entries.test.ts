import { describe, expect, it } from "vitest";
import type { DeviceTemplate, LogicTemplate } from "$logic/types";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";
import { filterTemplateEntries, templateEntries } from "./template-entries";

const device = {
  id: "d",
  name: "Lamp",
  description: "A visual lamp tile",
  help: "visualhelp",
  type: "Light",
  features: [],
  slots: [],
} as unknown as Template;
const logic = {
  id: "l",
  name: "Zulu",
  description: "Turns something on",
  help: "logichelp",
  params: [],
  logic: {},
} as unknown as LogicTemplate;
const api = {
  id: "a",
  name: "Meter",
  description: "Reads a meter",
  help: "apihelp",
  source: "({})",
} as DeviceTemplate;
const bundle = {
  id: "b",
  name: "TV",
  description: "TV plus logic",
  help: "bundlehelp",
  items: [],
  device: { type: "Custom", features: [], slots: [] },
  logic: { logic: {} },
} as unknown as TemplateBundle;

describe("templateEntries", () => {
  it("aggregates the four kinds with part badges", () => {
    const entries = templateEntries({
      presets: [],
      visual: [device],
      logicBuiltins: [],
      logicUser: [logic],
      apiBuiltins: [],
      apiUser: [api],
      bundleBuiltins: [],
      bundleUser: [bundle],
    });
    expect(entries.map((entry) => entry.kind)).toEqual([
      "device",
      "logic",
      "api",
      "bundle",
    ]);
    expect(entries[3].parts).toEqual(["device", "logic"]);
    expect(entries[3].type).toBe("Custom");
    expect(entries.map((entry) => entry.description)).toEqual([
      "A visual lamp tile",
      "Turns something on",
      "Reads a meter",
      "TV plus logic",
    ]);
    expect(entries.every((entry) => entry.builtin === false)).toBe(true);
    // A bundle is findable by the device type it creates.
    expect(
      filterTemplateEntries(entries, "custom", "asc").map((entry) => entry.id),
    ).toEqual(["b"]);
    expect(
      filterTemplateEntries(entries, "visual lamp", "asc").map(
        (entry) => entry.id,
      ),
    ).toEqual(["d"]);
    expect(
      filterTemplateEntries(entries, "reads a meter", "asc").map(
        (entry) => entry.id,
      ),
    ).toEqual(["a"]);
  });

  it("marks built-ins and filters/sorts", () => {
    const entries = templateEntries({
      presets: [device],
      visual: [],
      logicBuiltins: [logic],
      logicUser: [],
      apiBuiltins: [],
      apiUser: [],
      bundleBuiltins: [],
      bundleUser: [],
    });
    expect(entries.every((entry) => entry.builtin)).toBe(true);
    expect(
      filterTemplateEntries(entries, "lamp", "asc").map((entry) => entry.id),
    ).toEqual(["d"]);
    expect(filterTemplateEntries(entries, "", "desc")[0].id).toBe("l");
  });

  it("finds templates by help text", () => {
    const entries = templateEntries({
      presets: [],
      visual: [device],
      logicBuiltins: [],
      logicUser: [logic],
      apiBuiltins: [],
      apiUser: [api],
      bundleBuiltins: [],
      bundleUser: [bundle],
    });
    for (const [query, id] of [
      ["visualhelp", "d"],
      ["logichelp", "l"],
      ["apihelp", "a"],
      ["bundlehelp", "b"],
    ]) {
      expect(
        filterTemplateEntries(entries, query, "asc").map((entry) => entry.id),
      ).toEqual([id]);
    }
  });

  it("carries the secured flag only from user definitions", () => {
    const entries = templateEntries({
      presets: [device],
      visual: [{ ...device, secured: true }],
      logicBuiltins: [logic],
      logicUser: [{ ...logic, secured: true }],
      apiBuiltins: [api],
      apiUser: [{ ...api, secured: true }],
      bundleBuiltins: [bundle],
      bundleUser: [{ ...bundle, secured: true }],
    });
    expect(entries.map((entry) => entry.secured === true)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });
});
