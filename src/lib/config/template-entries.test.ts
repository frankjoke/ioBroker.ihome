import { describe, expect, it } from "vitest";
import type { DeviceTemplate, LogicTemplate } from "$logic/types";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";
import { filterTemplateEntries, templateEntries } from "./template-entries";

const device = {
  id: "d",
  name: "Lamp",
  type: "Light",
  features: [],
  slots: [],
} as unknown as Template;
const logic = {
  id: "l",
  name: "Zulu",
  params: [],
  logic: {},
} as unknown as LogicTemplate;
const api = { id: "a", name: "Meter", source: "({})" } as DeviceTemplate;
const bundle = {
  id: "b",
  name: "TV",
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
    expect(entries.every((entry) => entry.builtin === false)).toBe(true);
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
});
