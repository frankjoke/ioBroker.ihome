import { it, expect } from "vitest";
import {
  filterDevices,
  matchesMember,
  loadPages,
  parsePageRegistry,
  resolvePage,
  seedPages,
  toFilterable,
  type FilterableDevice,
} from "$lib/config/pages-ops";
import type { Page } from "$lib/types/display";

const dev = (over: Partial<FilterableDevice>): FilterableDevice => ({
  id: "x",
  name: "X",
  type: "Light",
  visibleControls: 1,
  ...over,
});

it("matches only what the member asks for", () => {
  const d = dev({
    room: "enum.rooms.WZ",
    functions: ["enum.functions.Licht"],
    tags: ["eg"],
  });
  expect(matchesMember(d, { room: "enum.rooms.WZ" })).toBe(true);
  expect(matchesMember(d, { room: "enum.rooms.Bad" })).toBe(false);
  expect(matchesMember(d, { function: "enum.functions.Licht" })).toBe(true);
  expect(matchesMember(d, { function: "enum.functions.Heizung" })).toBe(false);
  expect(matchesMember(d, { tags: ["eg"] })).toBe(true);
  expect(matchesMember(d, { tags: ["eg", "night"] })).toBe(false);
  expect(matchesMember(d, { room: "enum.rooms.WZ", type: "Switch" })).toBe(
    false,
  );
  expect(matchesMember(d, {})).toBe(false); // Review Focus 1
  expect(matchesMember(d, { ids: ["x"] })).toBe(true);
  expect(matchesMember(d, { ids: ["y"] })).toBe(false);
});

it("claims explicit ids first, keeps declaration order, never duplicates", () => {
  const page: Page = {
    id: "p",
    title: "Home",
    groups: [
      { id: "g1", member: { function: "enum.functions.Licht" } },
      { id: "g2", member: { ids: ["a"] } },
    ],
  };
  const devices = [
    dev({ id: "a", functions: ["enum.functions.Licht"] }),
    dev({ id: "b", functions: ["enum.functions.Licht"] }),
  ];
  const res = resolvePage(page, devices);
  expect(res.map((r) => r.group.id)).toEqual(["g1", "g2"]);
  expect(res.map((r) => r.devices.map((d) => d.id))).toEqual([["b"], ["a"]]);
});

it("hides device-less groups unless showEmpty", () => {
  const page: Page = {
    id: "p",
    title: "Home",
    groups: [
      { id: "g1", member: { room: "enum.rooms.Bad" } },
      { id: "g2", member: { room: "enum.rooms.Bad" }, showEmpty: true },
    ],
  };
  expect(resolvePage(page, [dev({})]).map((r) => r.group.id)).toEqual(["g2"]);
});

it("keeps a hidden-controls device out unless the group asks for empty", () => {
  const page: Page = {
    id: "p",
    title: "Home",
    groups: [
      { id: "g1", member: { room: "enum.rooms.Bad" } },
      { id: "g2", member: { room: "enum.rooms.Bad" }, showEmpty: true },
    ],
  };
  const empty = toFilterable({
    id: "x",
    name: "X",
    type: "Value",
    room: "enum.rooms.Bad",
    controls: [{ hidden: true }, { hidden: true }],
  });
  const res = resolvePage(page, [empty]);
  expect(res.map((r) => r.group.id)).toEqual(["g2"]);
  expect(res[0].devices.map((d) => d.id)).toEqual(["x"]);
});

it("treats a device with only hidden controls as empty", () => {
  expect(
    toFilterable({
      id: "x",
      name: "X",
      type: "Value",
      controls: [{ hidden: true }, { hidden: true }],
    }).visibleControls,
  ).toBe(0);
  expect(
    toFilterable({
      id: "x",
      name: "X",
      type: "Value",
      controls: [{}, { hidden: true }],
    }).visibleControls,
  ).toBe(1);
});

it("keeps the enriched device intact", () => {
  const enriched = { ...dev({ id: "a" }), liveValue: 42, controls: [] };
  const [group] = resolvePage(
    { id: "p", title: "P", groups: [{ id: "g", member: { ids: ["a"] } }] },
    [enriched],
  );
  expect(group.devices[0]).toBe(enriched);
});

it("filters by chip", () => {
  const a = dev({ id: "a", room: "enum.rooms.WZ" });
  const b = dev({
    id: "b",
    room: "enum.rooms.Bad",
    functions: ["enum.functions.Licht"],
  });
  expect(
    filterDevices([a, b], { room: "enum.rooms.Bad" }).map((d) => d.id),
  ).toEqual(["b"]);
  expect(filterDevices([a, b], {}).map((d) => d.id)).toEqual(["a", "b"]);
  expect(filterDevices([a, b], { function: "enum.functions.Heizung" })).toEqual(
    [],
  );
});

it("seeds one page of function groups and one page of room groups", () => {
  const reg = seedPages(
    [{ id: "enum.functions.Licht", label: "Licht" }],
    [{ id: "enum.rooms.WZ", label: "Wohn-Ess-Z" }],
  );
  expect(reg.seeded).toBe(true);
  // Rooms lead: they are populated today, while `functions` on a device is a new
  // field nobody has filled yet, so a function page would open empty.
  expect(reg.pages.map((p) => p.id)).toEqual(["rooms", "home"]);
  expect(reg.pages[0].groups[0].member).toEqual({ room: "enum.rooms.WZ" });
  expect(reg.pages[0].groups[0].title).toBe("Wohn-Ess-Z");
  expect(reg.pages[0].groups[0].id).toBe("room:enum.rooms.WZ");
  expect(reg.pages[1].groups[0].member).toEqual({
    function: "enum.functions.Licht",
  });
  expect(reg.pages[1].groups[0].title).toBe("Licht");
});

it("parses a page registry and rejects junk", () => {
  expect(parsePageRegistry("nope")).toBeNull();
  expect(parsePageRegistry({ pages: "x" })).toBeNull();
  expect(parsePageRegistry('{"version":2,"pages":[]}')?.pages).toEqual([]);
  expect(
    parsePageRegistry({
      val: { pages: [{ id: "p", title: "P", groups: [] }] },
    })?.pages.length,
  ).toBe(1);
  expect(parsePageRegistry({ val: "{bad json" })).toBeNull();
  expect(parsePageRegistry({ seeded: true, pages: [] })?.seeded).toBe(true);
});

it("keeps loaded pages and only seeds an absent document", () => {
  const loaded = { pages: [{ id: "a", title: "A", groups: [] }] };
  expect(loadPages(loaded).registry?.pages[0].id).toBe("a");
  const seeded = loadPages(null, () => ({
    version: 0,
    updatedAt: 1,
    seeded: true,
    pages: [{ id: "s", title: "S", groups: [] }],
  }));
  expect(seeded.kind).toBe("seeded");
  expect(seeded.registry?.pages[0].id).toBe("s");
  expect(loadPages(null).kind).toBe("absent");
  // A stored-but-empty document stays empty: deleting every page is a choice,
  // and re-seeding it on the next boot would undo it.
  expect(
    loadPages({ pages: [] }, () => ({
      version: 0,
      updatedAt: 1,
      seeded: true,
      pages: [{ id: "s", title: "S", groups: [] }],
    })).kind,
  ).toBe("loaded");
});

it("distinguishes absent, invalid and empty documents", () => {
  const seed = () => ({
    version: 0,
    updatedAt: 1,
    seeded: true as const,
    pages: [{ id: "s", title: "S", groups: [] }],
  });
  // Absent (an object exists but was never written) → seed, and only here.
  expect(loadPages(null, seed).kind).toBe("seeded");
  expect(loadPages(undefined, seed).kind).toBe("seeded");
  expect(loadPages("", seed).kind).toBe("seeded");
  // A stored document is authoritative, even an empty one (the user may have
  // deleted every page on purpose).
  expect(loadPages({ pages: [] }, seed).kind).toBe("loaded");
  expect(loadPages({ pages: [] }, seed).registry?.pages).toEqual([]);
  // Unreadable content must NOT be overwritten by a seed.
  expect(loadPages("{bad json", seed).kind).toBe("invalid");
  expect(loadPages({ nope: 1 }, seed).kind).toBe("invalid");
  // Absent with no seed available is just absent.
  expect(loadPages(null).kind).toBe("absent");
});

it("rejects documents that would crash the renderer", () => {
  expect(parsePageRegistry({ pages: [null] })).toBeNull();
  expect(parsePageRegistry({ pages: [{ id: "p" }] })).toBeNull();
  expect(
    parsePageRegistry({
      pages: [{ id: "p", title: "P", groups: [{ id: "g" }] }],
    }),
  ).toBeNull();
  expect(
    parsePageRegistry({
      pages: [{ id: "p", title: "P", groups: [{ id: "g", member: {} }] }],
    })?.pages.length,
  ).toBe(1);
});

it("treats a group without a member as matching nothing", () => {
  expect(matchesMember(dev({}), undefined as never)).toBe(false);
});
