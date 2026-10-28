import { it, expect } from "vitest";
import {
  mayWritePages,
  migratePageRegistry,
  parsePageRegistry,
} from "$lib/config/pages-ops";
import { movePlacement } from "$lib/config/layout-ops";
import { effectiveSpan } from "$lib/config/template-ops";
import { newId } from "$lib/utils/ids";
import type { Page, PageRegistry } from "$lib/types/display";

const dev = (over: Record<string, unknown> = {}) => ({
  id: "x",
  name: "X",
  type: "Light" as const,
  visibleControls: 1,
  ...over,
});

// ------------------------------------------------- C2: never migrate blind
it("does not migrate a member-based document while no device is known", () => {
  const reg: PageRegistry = {
    version: 0,
    updatedAt: 1,
    pages: [
      {
        id: "rooms",
        title: "Rooms",
        groups: [
          {
            id: "room:enum.rooms.Bad",
            title: "Bad",
            member: { room: "enum.rooms.Bad" },
          },
        ],
      },
    ],
  };
  // An empty device list means "nothing loaded yet", not "no devices exist":
  // migrating now would freeze `tiles: []` into the user's document forever.
  const blind = migratePageRegistry(reg, []);
  expect(blind.changed).toBe(false);
  expect(blind.registry).toBe(reg);

  // With the devices in place it migrates as before.
  const seen = migratePageRegistry(reg, [
    dev({ id: "a", room: "enum.rooms.Bad" }),
  ]);
  expect(seen.changed).toBe(true);
  expect(seen.registry.pages[0].groups[0].tiles).toHaveLength(1);
});

// ------------------------------------------- C3: reject malformed placements
it("rejects a document whose section lists are not placements", () => {
  const page = (tiles: unknown): Page =>
    ({ id: "p", title: "P", groups: [{ id: "g", tiles }] }) as unknown as Page;
  const doc = (tiles: unknown) => ({
    version: 1,
    updatedAt: 1,
    pages: [page(tiles)],
  });
  // not a list, or a list of things that are not placements
  expect(parsePageRegistry(doc({ oops: 1 }))).toBeNull();
  expect(parsePageRegistry(doc([null]))).toBeNull();
  expect(parsePageRegistry(doc([{ device: "a" }]))).toBeNull();
  expect(parsePageRegistry(doc([{ id: "t1" }]))).toBeNull();
  expect(
    parsePageRegistry(doc([{ id: "t1", device: "a", newLine: "yes" }])),
  ).toBeNull();
  // duplicates would collide in the renderer's keyed each
  expect(
    parsePageRegistry(
      doc([
        { id: "t1", device: "a" },
        { id: "t1", device: "b" },
      ]),
    ),
  ).toBeNull();
  // a valid one still parses, with or without the optional fields
  expect(parsePageRegistry(doc([{ id: "t1", device: "a" }]))).not.toBeNull();
  expect(
    parsePageRegistry(
      doc([{ id: "t1", device: "a", title: "A", newLine: true }]),
    ),
  ).not.toBeNull();
});

// ------------------------------------------------ C1: only write a real document
it("permits a write only for a loaded or seeded document", () => {
  expect(mayWritePages("loaded")).toBe(true);
  expect(mayWritePages("seeded")).toBe(true);
  expect(mayWritePages("invalid")).toBe(false);
  expect(mayWritePages("absent")).toBe(false);
  expect(mayWritePages(null)).toBe(false);
});

// ------------------------------------------- I7: a move to nowhere removes nothing
it("leaves the registry untouched when a move destination does not exist", () => {
  const reg: PageRegistry = {
    version: 1,
    updatedAt: 1,
    pages: [
      {
        id: "p",
        title: "P",
        groups: [{ id: "g", tiles: [{ id: "t1", device: "a" }] }],
      },
    ],
  };
  for (const to of [
    { pageId: "nope", sectionId: "g", index: 0 },
    { pageId: "p", sectionId: "nope", index: 0 },
    { pageId: "p", sectionId: "g", index: 9 },
  ]) {
    const out = movePlacement(
      reg,
      { pageId: "p", sectionId: "g", index: 0 },
      to,
    );
    expect(out.pages).toEqual(reg.pages);
  }
});

// ------------------------------------------- I2: an id works off localhost too
it("makes an id even where crypto.randomUUID is missing (plain HTTP)", () => {
  const real = globalThis.crypto;
  try {
    // A plain-HTTP origin has crypto.getRandomValues but no randomUUID.
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) },
      configurable: true,
    });
    const id = newId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(7);
    expect(newId()).not.toBe(id);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: real,
      configurable: true,
    });
  }
  expect(typeof newId()).toBe("string"); // and normally uses randomUUID
});

// ------------------------------------------- I3/I10: one effective size everywhere
it("a tile without a size is 1×1; its own size wins", () => {
  // The size comes from the tile only; there is no device/template chain.
  expect(effectiveSpan(undefined, "phone")).toEqual({ w: 1, h: 1 });
  // the placement's size wins
  expect(effectiveSpan({ size: { w: 2, h: 2 } }, "desktop")).toEqual({
    w: 2,
    h: 2,
  });
});
