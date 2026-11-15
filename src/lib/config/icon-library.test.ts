import { it, expect } from "vitest";
import {
  emptyIconPool,
  keywordWords,
  parseIconPool,
  seedLibrary,
} from "$lib/config/icon-library";

it("keywords are single lowercase words", () => {
  expect(keywordWords("Door / window")).toEqual(["door", "window"]);
  expect(keywordWords("lightbulb_outline")).toEqual(["lightbulb", "outline"]);
});

it("seeds the device-type and role glyphs once", () => {
  const seed = seedLibrary();
  expect(seed.length).toBeGreaterThan(20);
  expect(seed.every((icon) => icon.value && icon.keywords.length)).toBe(true);
  expect(new Set(seed.map((icon) => icon.value)).size).toBe(seed.length);
  expect(seed.some((icon) => icon.keywords.includes("door"))).toBe(true);
});

it("an absent document starts from the seed", () => {
  const pool = parseIconPool(undefined);
  expect(pool?.version).toBe(2);
  expect(pool?.library).toEqual(seedLibrary());
  expect(pool?.defaults).toEqual({ roles: {}, templates: {} });
});

it("migrates a v1 document", () => {
  const pool = parseIconPool({
    version: 1,
    icons: [
      {
        id: "lamp",
        name: "Lamp",
        value: "lightbulb",
        activeValue: "lightbulb_outline",
        group: "Light",
        keywords: ["Bright"],
        roles: ["switch.active"],
        templates: ["Door"],
      },
    ],
    overrides: { "builtin:type:light": { value: "wb_incandescent" } },
  });
  expect(pool?.version).toBe(2);
  expect(pool?.library[0]).toMatchObject({
    id: "lamp",
    keywords: ["light", "bright"],
  });
  expect(pool?.defaults.roles["switch.active"]).toEqual({
    value: "lightbulb",
    activeValue: "lightbulb_outline",
  });
  expect(pool?.defaults.templates["Door"]).toEqual({
    value: "lightbulb",
    activeValue: "lightbulb_outline",
  });
  expect(
    pool?.library.find((icon) => icon.id === "builtin:type:light")?.value,
  ).toBe("wb_incandescent");
});

it("first claim wins when two v1 rows fight over a role", () => {
  const pool = parseIconPool({
    version: 1,
    icons: [
      { id: "a", name: "A", value: "lightbulb", roles: ["light.*"] },
      { id: "b", name: "B", value: "bolt", roles: ["light.*"] },
    ],
  });
  expect(pool?.defaults.roles["light.*"]).toEqual({ value: "lightbulb" });
});

it("rejects an unknown version", () => {
  expect(parseIconPool({ version: 3, library: [] })).toBeNull();
});

it("keeps a v2 document as written", () => {
  const pool = {
    version: 2,
    updatedAt: 7,
    library: [{ id: "x", value: "bolt", keywords: ["power"] }],
    defaults: { roles: { state: { value: "bolt" } }, templates: {} },
  };
  expect(parseIconPool(pool)).toEqual(pool);
});

it("emptyIconPool is the seed with empty defaults", () => {
  expect(emptyIconPool()).toMatchObject({
    version: 2,
    updatedAt: 0,
    defaults: { roles: {}, templates: {} },
  });
});
