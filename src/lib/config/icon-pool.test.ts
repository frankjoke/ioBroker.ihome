import { expect, it } from "vitest";
import { DEVICE_TYPES } from "./features";
import { ROLE_GLYPH_DEFAULTS } from "./icon-ops";
import {
  BUILTIN_POOL,
  POOL_CAP,
  filterPoolIcons,
  mdiIconValue,
  clearBaseOverride,
  parseIconPool,
  poolEntries,
  removePoolIcon,
  setBaseOverride,
  upsertPoolIcon,
} from "./icon-pool";

it("survives an empty document and rejects a broken one", () => {
  expect(parseIconPool(undefined)).toEqual({
    version: 1,
    updatedAt: 0,
    icons: [],
  });
  expect(parseIconPool("")).toEqual({ version: 1, updatedAt: 0, icons: [] });
  expect(parseIconPool("   ")).toEqual({ version: 1, updatedAt: 0, icons: [] });
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

it("caps the document at 500 icons", () => {
  const icons = Array.from({ length: POOL_CAP + 1 }, (_, i) => ({
    id: `i${i}`,
    name: `Icon ${i}`,
    value: `value-${i}`,
  }));
  const parsed = parseIconPool(JSON.stringify({ version: 1, icons }));
  expect(parsed?.icons).toHaveLength(POOL_CAP);
});

it("rejects a future document instead of downgrading it", () => {
  expect(parseIconPool(JSON.stringify({ version: 2, icons: [] }))).toBeNull();
});

it("trims entries and drops whitespace-only ones", () => {
  const raw = JSON.stringify({
    version: 1,
    icons: [
      { id: " a ", name: " Lamp ", value: " lightbulb ", group: " Light " },
      { id: "   ", name: "Broken", value: "x" },
    ],
  });
  expect(parseIconPool(raw)?.icons).toEqual([
    { id: "a", name: "Lamp", value: "lightbulb", group: "Light" },
  ]);
});

it("keeps an MDI SVG value through a parse round-trip", () => {
  const value = mdiIconValue("M1 2");
  const parsed = parseIconPool(
    JSON.stringify({
      version: 1,
      icons: [{ id: "m", name: "MDI", value }],
    }),
  );
  expect(parsed?.icons[0].value).toBe(value);
});

it("upserts and removes one icon by id", () => {
  const pool = { version: 1 as const, updatedAt: 0, icons: [] };
  const added = upsertPoolIcon(pool, { id: "a", name: "A", value: "x" });
  expect(added.icons).toHaveLength(1);
  const replaced = upsertPoolIcon(added, { id: "a", name: "B", value: "y" });
  expect(replaced.icons).toEqual([{ id: "a", name: "B", value: "y" }]);
  expect(replaced.updatedAt).toBeGreaterThan(0);
  expect(removePoolIcon(replaced, "a").icons).toHaveLength(0);
});

it("keeps a pair through a parse round-trip", () => {
  const parsed = parseIconPool(
    JSON.stringify({
      version: 1,
      icons: [
        { id: "g", name: "Gate", value: "gate", activeValue: "gate_open" },
      ],
    }),
  );
  expect(parsed?.icons[0]).toEqual({
    id: "g",
    name: "Gate",
    value: "gate",
    activeValue: "gate_open",
  });
});

it("applies overrides to base entries and resets them", () => {
  const base = BUILTIN_POOL[0];
  const pool = setBaseOverride(
    { version: 1, updatedAt: 0, icons: [] },
    base.id,
    { value: "power", activeValue: "power_off" },
  );
  const entry = poolEntries(pool).find((item) => item.id === base.id);
  expect(entry?.value).toBe("power");
  expect(entry?.activeValue).toBe("power_off");
  const reset = poolEntries(clearBaseOverride(pool, base.id)).find(
    (item) => item.id === base.id,
  );
  expect(reset?.value).toBe(base.value);
  expect(reset?.activeValue).toBeUndefined();
});

it("parses overrides and applies them on load", () => {
  const base = BUILTIN_POOL[0];
  const parsed = parseIconPool(
    JSON.stringify({
      version: 1,
      icons: [],
      overrides: { [base.id]: { value: "power", activeValue: "power_off" } },
    }),
  );
  const entry = poolEntries(parsed).find((item) => item.id === base.id);
  expect(entry?.value).toBe("power");
  expect(entry?.activeValue).toBe("power_off");
});

it("drops invalid and unknown overrides", () => {
  const parsed = parseIconPool(
    JSON.stringify({
      version: 1,
      icons: [],
      overrides: {
        nope: { value: "x" },
        [BUILTIN_POOL[0].id]: { value: "" },
      },
    }),
  );
  expect(parsed?.overrides).toBeUndefined();
});

it("preserves overrides across user upsert and remove", () => {
  const base = BUILTIN_POOL[0];
  const pool = setBaseOverride(
    { version: 1, updatedAt: 0, icons: [] },
    base.id,
    { activeValue: "power_off" },
  );
  const added = upsertPoolIcon(pool, { id: "u", name: "U", value: "x" });
  expect(added.overrides).toEqual(pool.overrides);
  expect(removePoolIcon(added, "u").overrides).toEqual(pool.overrides);
});

it("exposes base entries without storing them", () => {
  const document = { version: 1 as const, updatedAt: 0, icons: [] };
  expect(poolEntries(document)).toHaveLength(BUILTIN_POOL.length);
  expect(document.icons).toHaveLength(0);
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
