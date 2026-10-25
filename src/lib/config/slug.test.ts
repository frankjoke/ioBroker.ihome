import { it, expect } from "vitest";
import { slugify, uniqueSlug } from "$lib/config/slug";

it("slugifies a page title into a readable id", () => {
  expect(slugify("Wohnzimmer")).toBe("wohnzimmer");
  expect(slugify("  Bad  ")).toBe("bad");
  expect(slugify("Küche & Bad")).toBe("kueche-bad");
  expect(slugify("Gäste-Spiele (GaesteSpielezimmer)")).toBe(
    "gaeste-spiele-gaestespielezimmer",
  );
  expect(slugify("Café")).toBe("cafe");
  expect(slugify("Öl / Gas")).toBe("oel-gas");
});

it("slugify yields nothing for a name without latin letters", () => {
  expect(slugify("中文")).toBe("");
  expect(slugify("   ")).toBe("");
  expect(slugify("")).toBe("");
});

it("slugify caps the length without a trailing dash", () => {
  const long = slugify("a".repeat(60));
  expect(long.length).toBe(48);
  expect(long.endsWith("-")).toBe(false);
  expect(slugify("-".repeat(5))).toBe("");
});

it("uniqueSlug appends a counter only when the id is taken", () => {
  expect(uniqueSlug("rooms", ["rooms"])).toBe("rooms-2");
  expect(uniqueSlug("rooms", ["rooms", "rooms-2"])).toBe("rooms-3");
  expect(uniqueSlug("rooms", ["home"])).toBe("rooms");
  expect(uniqueSlug("", ["rooms"])).toBe("");
});
