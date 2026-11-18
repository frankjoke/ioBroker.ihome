import { it, expect } from "vitest";
import {
  BUILTIN_DEFAULTS,
  BUILTIN_ICONS,
  BUILTIN_SEED_VERSION,
  BUILTIN_TWINS,
  defaultPair,
  effectiveDefault,
  emptyIconPool,
  ensureBuiltinDefaults,
  filterLibrary,
  filterLibraryNames,
  hasIconValue,
  keywordWords,
  libraryKeywordCounts,
  normalizeIconPool,
  offTwin,
  onTwin,
  pairChoices,
  parseIconPool,
  removeLibraryIcon,
  roleChoicesFromObjects,
  seedLibrary,
  setDefault,
  setTwin,
  splitTwins,
  suggestTwin,
  upsertLibraryIcon,
  type IconPool,
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
  expect(pool?.version).toBe(3);
  expect(pool?.library).toEqual(seedLibrary());
  expect(pool?.twins).toEqual({});
  expect(pool?.defaults).toEqual({ roles: {}, templates: {} });
});

it("migrates a v1 document into rows, twins and string defaults", () => {
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
  expect(pool?.version).toBe(3);
  expect(pool?.library[0]).toMatchObject({
    id: "lamp",
    keywords: ["light", "bright"],
  });
  expect(pool?.library.some((icon) => icon.value === "lightbulb_outline")).toBe(
    true,
  );
  expect(pool?.twins).toEqual({ lightbulb: "lightbulb_outline" });
  expect(pool?.defaults.roles["switch.active"]).toBe("lightbulb");
  expect(pool?.defaults.templates.Door).toBe("lightbulb");
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
  expect(pool?.defaults.roles["light.*"]).toBe("lightbulb");
});

it("upgrades a v2 document: pairs become rows plus twins", () => {
  const pool = parseIconPool({
    version: 2,
    updatedAt: 7,
    library: [
      {
        id: "x",
        name: "Lamp",
        value: "lamp",
        activeValue: "lamp_on",
        keywords: ["light"],
      },
    ],
    defaults: {
      roles: { state: { value: "lamp", activeValue: "lamp_on" } },
      templates: {},
    },
  });
  expect(pool?.version).toBe(3);
  expect(pool?.library.map((icon) => icon.value)).toEqual(["lamp", "lamp_on"]);
  expect(pool?.twins).toEqual({ lamp: "lamp_on" });
  expect(pool?.defaults.roles.state).toBe("lamp");
});

it("keeps a v3 document as written", () => {
  const doc = {
    version: 3,
    updatedAt: 5,
    library: [{ id: "x", value: "bolt", keywords: ["power"] }],
    twins: { bolt: "bolt_on" },
    defaults: { roles: { state: "bolt" }, templates: {} },
  };
  expect(parseIconPool(doc)).toEqual(doc);
});

it("rejects an unknown version", () => {
  expect(parseIconPool({ version: 4, library: [] })).toBeNull();
});

it("rejects a v1 document without an icons array", () => {
  expect(parseIconPool({ version: 1, overrides: {} })).toBeNull();
});

it("emptyIconPool is the seed with empty twins and defaults", () => {
  expect(emptyIconPool()).toMatchObject({
    version: 3,
    updatedAt: 0,
    twins: {},
    defaults: { roles: {}, templates: {} },
  });
});

const library: LibraryIcon[] = [
  { id: "l", value: "lightbulb", keywords: ["light", "switch"] },
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
});

it("counts keywords by use, then by name", () => {
  expect(libraryKeywordCounts(library)).toEqual([
    { keyword: "switch", count: 2 },
    { keyword: "door", count: 1 },
    { keyword: "light", count: 1 },
    { keyword: "power", count: 1 },
  ]);
});

it("finds a library row by name, value or keyword", () => {
  expect(
    filterLibraryNames([{ ...library[0], name: "Lamp" }], "lamp").map(
      (icon) => icon.id,
    ),
  ).toEqual(["l"]);
  expect(filterLibraryNames(library, "bolt").map((icon) => icon.id)).toEqual([
    "p",
  ]);
  expect(filterLibraryNames(library, "doo").map((icon) => icon.id)).toEqual([
    "d",
  ]);
  expect(filterLibraryNames(library, "")).toHaveLength(3);
});

it("splits pairs from singles through the twins map", () => {
  const { pairs, singles } = splitTwins(library, {
    lightbulb: "lightbulb_outline",
  });
  expect(pairs.map((icon) => icon.id)).toEqual(["l"]);
  expect(singles.map((icon) => icon.id)).toEqual(["p", "d"]);
});

it("resolves a default template first, then role, then family, plus its twin", () => {
  const pool = emptyIconPool();
  pool.twins.z = "zy";
  pool.defaults.templates.Door = "t";
  pool.defaults.roles["switch.active"] = "x";
  pool.defaults.roles["light.*"] = "z";
  expect(defaultPair(pool, "Door", "switch.active")).toEqual({ value: "t" });
  expect(defaultPair(pool, "Nope", "switch.active")).toEqual({ value: "x" });
  expect(defaultPair(pool, undefined, "light.dimmer")).toEqual({
    value: "z",
    activeValue: "zy",
  });
  expect(defaultPair(pool, undefined, "state")).toBeUndefined();
});

it("resolves an effective default through the role family", () => {
  const pool = emptyIconPool();
  pool.defaults.roles["light.*"] = "z";
  pool.defaults.roles["light.dimmer"] = "exact";
  expect(effectiveDefault(pool, "roles", "light.dimmer")).toBe("exact");
  expect(effectiveDefault(pool, "roles", "light.color")).toBe("z");
  expect(effectiveDefault(pool, "roles", "switch.active")).toBeUndefined();
  expect(effectiveDefault(pool, "templates", "Door")).toBeUndefined();
});

it("sets, overwrites and clears a default", () => {
  let pool = emptyIconPool();
  pool = setDefault(pool, "roles", "light.*", "x");
  expect(pool.defaults.roles["light.*"]).toBe("x");
  pool = setDefault(pool, "roles", "light.*", "z");
  expect(pool.defaults.roles["light.*"]).toBe("z");
  pool = setDefault(pool, "templates", "Door", "t");
  expect(pool.defaults.templates.Door).toBe("t");
  pool = setDefault(pool, "roles", "light.*", null);
  expect(pool.defaults.roles["light.*"]).toBeUndefined();
  expect(pool.updatedAt).toBeGreaterThan(0);
});

it("pairs an icon and lists its twin as a library row", () => {
  let pool = emptyIconPool();
  pool = setTwin(pool, "lightbulb", "lightbulb_outline");
  expect(pool.twins).toEqual({ lightbulb: "lightbulb_outline" });
  expect(pool.library.some((icon) => icon.value === "lightbulb_outline")).toBe(
    true,
  );
  pool = setTwin(pool, "lightbulb", "lightbulb_on");
  expect(pool.twins.lightbulb).toBe("lightbulb_on");
  pool = setTwin(pool, "lightbulb", null);
  expect(pool.twins.lightbulb).toBeUndefined();
});

it("upserts by id and drops a pairing when either half is removed", () => {
  let pool = setTwin(emptyIconPool(), "lightbulb", "lightbulb_outline");
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

  pool = removeLibraryIcon(
    changed,
    changed.library.find((icon) => icon.value === "lightbulb")!.id,
  );
  expect(pool.twins.lightbulb).toBeUndefined();

  const paired = setTwin(emptyIconPool(), "lightbulb", "lightbulb_outline");
  const removed = removeLibraryIcon(
    paired,
    paired.library.find((icon) => icon.value === "lightbulb_outline")!.id,
  );
  expect(removed.twins.lightbulb).toBeUndefined();
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

it("finds a twin in both directions", () => {
  const twins = { "bulb-off": "bulb-on" };
  expect(onTwin(twins, "bulb-off")).toBe("bulb-on");
  expect(onTwin(twins, "bulb-on")).toBeUndefined();
  expect(offTwin(twins, "bulb-on")).toBe("bulb-off");
  expect(offTwin(twins, "bulb-off")).toBeUndefined();
  expect(onTwin({}, "x")).toBeUndefined();
  expect(offTwin({}, "x")).toBeUndefined();
});

it("seeds the built-in defaults additively and once", () => {
  const pool = parseIconPool(
    JSON.stringify({
      version: 3,
      updatedAt: 1,
      library: [
        {
          id: "mine",
          value: "/ihome/icons/builtin/light-off.svg",
          keywords: [],
        },
      ],
      twins: {},
      defaults: { roles: { "switch.light": "/my/light.svg" }, templates: {} },
    }),
  )!;
  const once = ensureBuiltinDefaults(pool);
  expect(once.builtin).toBe(BUILTIN_SEED_VERSION);
  expect(once.library.find((i) => i.id === "mine")).toBeTruthy();
  expect(
    once.library.filter(
      (i) => i.value === "/ihome/icons/builtin/light-off.svg",
    ),
  ).toHaveLength(1);
  expect(once.defaults.roles["switch.light"]).toBe("/my/light.svg");
  expect(once.defaults.roles["sensor.motion"]).toBe(
    BUILTIN_DEFAULTS.roles["sensor.motion"],
  );
  expect(once.twins["/ihome/icons/builtin/switch-off.svg"]).toBe(
    "/ihome/icons/builtin/switch-on.svg",
  );
  expect(ensureBuiltinDefaults(once)).toBe(once);
});

it("keeps every built-in reference inside the built-in rows", () => {
  const values = new Set(BUILTIN_ICONS.map((icon) => icon.value));
  for (const [off, on] of Object.entries(BUILTIN_TWINS)) {
    expect(values.has(off)).toBe(true);
    expect(values.has(on)).toBe(true);
  }
  for (const value of [
    ...Object.values(BUILTIN_DEFAULTS.roles),
    ...Object.values(BUILTIN_DEFAULTS.templates),
  ]) {
    expect(values.has(value)).toBe(true);
  }
  expect(BUILTIN_SEED_VERSION).toBe(1);
  expect(
    parseIconPool(JSON.stringify({ version: 3, library: [], builtin: 1 }))
      ?.builtin,
  ).toBe(1);
});

it("keeps the builtin marker on a normalized save", () => {
  const pool = ensureBuiltinDefaults(emptyIconPool());
  const saved = normalizeIconPool(pool);
  expect(saved.builtin).toBe(BUILTIN_SEED_VERSION);
  expect(ensureBuiltinDefaults(saved)).toBe(saved);
});

const twinPool = (twins: Record<string, string> = {}): IconPool => ({
  ...emptyIconPool(),
  library: [
    { id: "1", value: "bulb_off", keywords: [] },
    { id: "2", value: "bulb_on", keywords: [] },
    { id: "3", value: "lamp-outline", keywords: [] },
    { id: "4", value: "lamp-filled", keywords: [] },
    { id: "5", value: "door_open", keywords: [] },
    { id: "6", value: "door_closed", keywords: [] },
    { id: "7", value: "solo", keywords: [] },
  ],
  twins,
});

it("suggests the counterpart by naming pattern", () => {
  const pool = twinPool();
  expect(suggestTwin(pool, "bulb_off")).toEqual({
    off: "bulb_off",
    on: "bulb_on",
  });
  expect(suggestTwin(pool, "bulb_on")).toEqual({
    off: "bulb_off",
    on: "bulb_on",
  });
  expect(suggestTwin(pool, "lamp-outline")).toEqual({
    off: "lamp-outline",
    on: "lamp-filled",
  });
  expect(suggestTwin(pool, "lamp-filled")).toEqual({
    off: "lamp-outline",
    on: "lamp-filled",
  });
  expect(suggestTwin(pool, "door_closed")).toEqual({
    off: "door_open",
    on: "door_closed",
  });
  expect(suggestTwin(pool, "solo")).toBeUndefined();
});

it("keeps the current twin and refuses a paired counterpart", () => {
  expect(suggestTwin(twinPool({ bulb_off: "bulb_on" }), "bulb_on")).toEqual({
    off: "bulb_off",
    on: "bulb_on",
  });
  expect(
    suggestTwin(twinPool({ other: "bulb_on" }), "bulb_off"),
  ).toBeUndefined();
});

it("offers pair halves separately only for single fields", () => {
  expect(pairChoices("bulb_off", "bulb_on", false)).toEqual([
    { value: "bulb_off" },
    { value: "bulb_on" },
  ]);
  expect(pairChoices("bulb_off", "bulb_on", true)).toEqual([
    { value: "bulb_off", active: "bulb_on" },
  ]);
  expect(pairChoices("solo", undefined, true)).toEqual([{ value: "solo" }]);
});
