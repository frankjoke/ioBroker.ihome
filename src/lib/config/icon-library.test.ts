import { it, expect } from "vitest";
import {
  defaultPair,
  emptyIconPool,
  filterLibrary,
  hasIconValue,
  keywordWords,
  libraryKeywordCounts,
  parseIconPool,
  removeLibraryIcon,
  roleChoicesFromObjects,
  seedLibrary,
  setDefault,
  splitTwins,
  upsertLibraryIcon,
  type LibraryIcon,
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

const library: LibraryIcon[] = [
  {
    id: "l",
    value: "lightbulb",
    activeValue: "lightbulb_outline",
    keywords: ["light", "switch"],
  },
  { id: "p", value: "bolt", keywords: ["power", "switch"] },
  { id: "d", value: "sensor_door", keywords: ["door"] },
];

it("filters by every selected keyword and the search", () => {
  expect(filterLibrary(library, ["light"], "").map((icon) => icon.id)).toEqual([
    "l",
  ]);
  expect(
    filterLibrary(library, ["light", "switch"], "").map((icon) => icon.id),
  ).toEqual(["l"]);
  expect(
    filterLibrary(library, ["light", "door"], "").map((icon) => icon.id),
  ).toEqual([]);
  expect(filterLibrary(library, [], "SWI")).toHaveLength(2);
  expect(filterLibrary(library, [], "bolt")).toEqual([]);
});

it("counts keywords by use, then by name", () => {
  expect(libraryKeywordCounts(library)).toEqual([
    { keyword: "switch", count: 2 },
    { keyword: "door", count: 1 },
    { keyword: "light", count: 1 },
    { keyword: "power", count: 1 },
  ]);
});

it("splits twins from singles", () => {
  const { twins, singles } = splitTwins(library);
  expect(twins.map((icon) => icon.id)).toEqual(["l"]);
  expect(singles.map((icon) => icon.id)).toEqual(["p", "d"]);
});

it("resolves a default template first, then role, then family", () => {
  const pool = emptyIconPool();
  pool.defaults.templates.Door = { value: "t" };
  pool.defaults.roles["switch.active"] = { value: "x", activeValue: "y" };
  pool.defaults.roles["light.*"] = { value: "z" };
  expect(defaultPair(pool, "Door", "switch.active")).toEqual({ value: "t" });
  expect(defaultPair(pool, "Nope", "switch.active")).toEqual({
    value: "x",
    activeValue: "y",
  });
  expect(defaultPair(pool, undefined, "light.dimmer")).toEqual({ value: "z" });
  expect(defaultPair(pool, undefined, "state")).toBeUndefined();
});

it("upserts by id and removes by id", () => {
  const pool = emptyIconPool();
  const added = upsertLibraryIcon(pool, {
    id: "n",
    value: "my.svg",
    keywords: ["door"],
  });
  expect(added.library.at(-1)).toMatchObject({ id: "n" });
  const changed = upsertLibraryIcon(added, {
    id: "n",
    value: "my.svg",
    keywords: ["door", "gate"],
  });
  expect(changed.library.filter((icon) => icon.id === "n")).toHaveLength(1);
  expect(changed.library.find((icon) => icon.id === "n")?.keywords).toEqual([
    "door",
    "gate",
  ]);
  expect(
    removeLibraryIcon(changed, "n").library.some((i) => i.id === "n"),
  ).toBe(false);
});

it("sees a value that is already in the library", () => {
  expect(hasIconValue(library, "bolt")).toBe(true);
  expect(hasIconValue(library, "bolt_outline")).toBe(false);
});

it("builds role choices from state roles only", () => {
  const objects = new Map<string, unknown>([
    ["a.0.x", { type: "state", common: { role: "switch.active" } }],
    ["a.0.y", { type: "state", common: { role: "switch.active" } }],
    ["a.0.z", { type: "state", common: { role: "light.dimmer" } }],
    ["a.0.c", { type: "channel", common: { role: "switch" } }],
  ]);
  expect(roleChoicesFromObjects(objects)).toEqual([
    { value: "switch.active", label: "switch.active · 2" },
    { value: "light.dimmer", label: "light.dimmer · 1" },
    { value: "switch.*", label: "switch.* · 2" },
    { value: "light.*", label: "light.* · 1" },
  ]);
});

it("sets, overwrites and clears a default", () => {
  let pool = emptyIconPool();
  pool = setDefault(pool, "roles", "light.*", {
    value: "x",
    activeValue: "y",
  });
  expect(pool.defaults.roles["light.*"]).toEqual({
    value: "x",
    activeValue: "y",
  });
  pool = setDefault(pool, "roles", "light.*", { value: "z" });
  expect(pool.defaults.roles["light.*"]).toEqual({ value: "z" });
  pool = setDefault(pool, "templates", "Door", { value: "t" });
  expect(pool.defaults.templates.Door).toEqual({ value: "t" });
  pool = setDefault(pool, "roles", "light.*", null);
  expect(pool.defaults.roles["light.*"]).toBeUndefined();
  expect(pool.updatedAt).toBeGreaterThan(0);
});
