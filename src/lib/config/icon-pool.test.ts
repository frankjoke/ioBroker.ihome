import { expect, it } from "vitest";
import { DEVICE_TYPES } from "./features";
import { ROLE_GLYPH_DEFAULTS } from "./icon-ops";
import {
  BUILTIN_POOL,
  filterPoolIcons,
  mdiIconValue,
  parseIconPool,
  poolEntries,
} from "./icon-pool";

it("survives an empty document and rejects a broken one", () => {
  expect(parseIconPool(undefined)).toEqual({
    version: 1,
    updatedAt: 0,
    icons: [],
  });
  expect(parseIconPool("")).toEqual({ version: 1, updatedAt: 0, icons: [] });
  expect(parseIconPool("not json")).toBeNull();
  expect(parseIconPool({ icons: "no" })).toBeNull();
});

it("accepts valid icons, drops duplicates and caps", () => {
  const raw = JSON.stringify({
    version: 1,
    updatedAt: 5,
    icons: [
      { id: "a", name: "A", value: "lightbulb" },
      { id: "a", name: "A2", value: "power" },
      { id: "b", name: "", value: "x" },
    ],
  });
  expect(parseIconPool(raw)?.icons.map((icon) => icon.id)).toEqual(["a"]);
});

it("has every device type and role default, deduped", () => {
  for (const type of DEVICE_TYPES) {
    expect(BUILTIN_POOL.some((icon) => icon.name === type)).toBe(true);
  }
  for (const role of ROLE_GLYPH_DEFAULTS) {
    expect(
      BUILTIN_POOL.some(
        (icon) => icon.keywords?.includes(role.name) || icon.name === role.name,
      ),
    ).toBe(true);
  }
  const values = BUILTIN_POOL.map((icon) => icon.value);
  expect(new Set(values).size).toBe(values.length);
});

it("combines base and user, base wins a duplicate value", () => {
  const base = BUILTIN_POOL[0];
  const entries = poolEntries({
    version: 1,
    updatedAt: 0,
    icons: [{ id: "u1", name: "mine", value: base.value }],
  });
  expect(entries.some((entry) => entry.builtin)).toBe(true);
  expect(entries.filter((entry) => entry.value === base.value)).toHaveLength(1);
});

it("filters name, group and keywords", () => {
  const entries = [
    {
      id: "x",
      name: "Lamp",
      group: "Lighting",
      value: "lightbulb",
      keywords: ["light"],
    },
  ];
  expect(filterPoolIcons(entries, "lamp")).toHaveLength(1);
  expect(filterPoolIcons(entries, "lighting")).toHaveLength(1);
  expect(filterPoolIcons(entries, "light")).toHaveLength(1);
  expect(filterPoolIcons(entries, "nope")).toHaveLength(0);
});

it("wraps an MDI path as a theme-coloured HTML icon", () => {
  expect(mdiIconValue("M1 2")).toBe(
    '<svg viewBox="0 0 24 24" fill="{{$color}}"><path d="M1 2"/></svg>',
  );
});
