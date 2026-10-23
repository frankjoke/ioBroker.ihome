import { it, expect } from "vitest";
import { pagePlaceholder } from "$lib/config/pages-ops";
import {
  backfillEnumFields,
  filterDevices,
  matchesMember,
  loadPages,
  parsePageRegistry,
  migratePageRegistry,
  PAGE_REGISTRY_VERSION,
  resolveByMember,
  resolvePage,
  seedPages,
  toFilterable,
  type FilterableDevice,
} from "$lib/config/pages-ops";
import type { Page } from "$lib/types/display";
import { PRESETS } from "$lib/config/presets";
import { DEVICE_TYPES } from "$lib/config/features";

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
  const res = resolveByMember(page, devices);
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
  expect(resolveByMember(page, [dev({})]).map((r) => r.group.id)).toEqual([
    "g2",
  ]);
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
  const res = resolveByMember(page, [empty]);
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
  const [group] = resolveByMember(
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
      pages: [{ id: "p", title: "P", groups: [{ title: "no id" }] }],
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

it("seeds only the axes that can actually render", () => {
  const both = seedPages(
    [{ id: "enum.functions.Licht", label: "Licht" }],
    [{ id: "enum.rooms.WZ", label: "WZ" }],
  );
  expect(both.pages.map((p) => p.id)).toEqual(["rooms", "home"]);

  const roomsOnly = seedPages([], [{ id: "enum.rooms.WZ", label: "WZ" }]);
  expect(roomsOnly.pages.map((p) => p.id)).toEqual(["rooms"]);

  const functionsOnly = seedPages(
    [{ id: "enum.functions.Licht", label: "Licht" }],
    [],
  );
  expect(functionsOnly.pages.map((p) => p.id)).toEqual(["home"]);

  // A broker with neither axis gets no pages (the display says so honestly)
  // rather than a page that can never show anything.
  expect(seedPages([], []).pages).toEqual([]);
});

it("backfills device functions and favorites from the broker enums", () => {
  const enums: any = {
    get: (id: string) =>
      ({
        "alias.0.EG.Light.SET": {
          functions: [{ _id: "enum.functions.Licht" }],
          favorites: [{ _id: "enum.favorites.EG" }],
        },
        "alias.0.EG.Light.BRIGHTNESS": {
          functions: [{ _id: "enum.functions.Licht" }],
        },
      })[id],
  };
  const devices: any[] = [
    {
      id: "d1",
      name: "L",
      type: "Light",
      controls: [
        {
          id: "c1",
          feature: "power",
          writable: true,
          stateId: "alias.0.EG.Light.SET",
        },
        {
          id: "c2",
          feature: "brightness",
          writable: true,
          stateId: "alias.0.EG.Light.BRIGHTNESS",
        },
      ],
    },
    {
      id: "d2",
      name: "Keep",
      type: "Switch",
      functions: ["enum.functions.Mine"],
      favorites: ["enum.favorites.Mine"],
      controls: [
        {
          id: "c3",
          feature: "power",
          writable: true,
          stateId: "alias.0.EG.Light.SET",
        },
      ],
    },
    { id: "d3", name: "NoState", type: "Value", controls: [] },
  ];
  const { devices: out, changed } = backfillEnumFields(devices, enums);
  expect(changed).toBe(1);
  expect(out[0].functions).toEqual(["enum.functions.Licht"]);
  expect(out[0].favorites).toEqual(["enum.favorites.EG"]);
  // An explicit assignment is never overwritten.
  expect(out[1].functions).toEqual(["enum.functions.Mine"]);
  expect(out[2].functions).toBeUndefined();
});

it("a thermometer preset declares two readout slots, not one", () => {
  const thermos = PRESETS.Thermometer.slots.filter((s) => s.kind === "value");
  expect(thermos.map((s) => s.options?.index)).toEqual([1, 2]);
  // and no preset loses a repeated slot to the merge key
  for (const type of DEVICE_TYPES) {
    const keys = PRESETS[type].slots.map(
      (s) => `${s.kind}:${s.source ?? ""}:${s.options?.index ?? ""}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  }
});

it("accepts a section with no member and a placement list", () => {
  const reg = parsePageRegistry({
    version: 1,
    updatedAt: 1,
    pages: [
      {
        id: "p",
        title: "P",
        groups: [
          {
            id: "g",
            title: "G",
            appearance: { border: false },
            tiles: [{ id: "t1", device: "dev1" }],
          },
        ],
      },
    ],
  });
  expect(reg).not.toBeNull();
  expect(reg!.pages[0].groups[0].member).toBeUndefined();
  expect(reg!.pages[0].groups[0].tiles?.[0].device).toBe("dev1");
  expect(reg!.pages[0].groups[0].appearance?.border).toBe(false);
});

it('keeps a placement\'s empty title — `""` is a name of its own (A41)', () => {
  const reg = parsePageRegistry({
    version: 1,
    updatedAt: 1,
    pages: [
      {
        id: "p",
        title: "P",
        groups: [
          {
            id: "g",
            title: "G",
            tiles: [{ id: "t1", device: "dev1", title: "" }],
          },
        ],
      },
    ],
  });
  expect(reg).not.toBeNull();
  expect(reg!.pages[0].groups[0].tiles?.[0].title).toBe("");
});

// ------------------------------------------------------------- the migration
// Task 2: a stored document carries member-based sections; the display wants
// explicit placements. The migration is the one-time bridge between them.

const memberPage = (): Page => ({
  id: "rooms",
  title: "Rooms",
  groups: [
    {
      id: "room:enum.rooms.WZ",
      title: "WZ",
      member: { room: "enum.rooms.WZ" },
    },
  ],
});

const wzDevices = [
  dev({ id: "a", room: "enum.rooms.WZ" }),
  dev({ id: "b", room: "enum.rooms.WZ" }),
];

it("expands a seeded section into placements, in the resolver's order, keeping the member hint", () => {
  const reg = { version: 0, updatedAt: 1, pages: [memberPage()] };
  const { registry, changed } = migratePageRegistry(reg, wzDevices);
  expect(changed).toBe(true);
  expect(registry.version).toBe(PAGE_REGISTRY_VERSION);
  const g = registry.pages[0].groups[0];
  expect(g.tiles?.map((t) => t.device)).toEqual(["a", "b"]);
  expect(g.member).toEqual({ room: "enum.rooms.WZ" });
  expect(g.tiles?.[0].id).toBeTruthy();
  expect(g.tiles?.[0].id).not.toBe(g.tiles?.[1].id);
});

it("is idempotent and leaves an already-migrated registry alone", () => {
  const once = migratePageRegistry(
    { version: 0, updatedAt: 1, pages: [memberPage()] },
    wzDevices,
  ).registry;
  const twice = migratePageRegistry(once, wzDevices);
  expect(twice.changed).toBe(false);
  expect(twice.registry).toEqual(once);
});

it("migrates an empty section to an empty list and never invents placements", () => {
  const reg = {
    version: 0,
    updatedAt: 1,
    pages: [
      {
        id: "p",
        title: "P",
        groups: [{ id: "g", member: { room: "enum.rooms.Nowhere" } }],
      },
    ],
  };
  const { registry } = migratePageRegistry(reg, [dev({})]);
  expect(registry.pages[0].groups[0].tiles).toEqual([]);
});

it("refuses to touch a registry that was never loaded", () => {
  // The store's initial value: no pages and no `updatedAt`. Loading can fail
  // (a disconnect while reading), and migrating *that* would write an empty
  // document over the user's pages.
  const notLoaded = { version: 0, updatedAt: 0, pages: [] };
  const out = migratePageRegistry(notLoaded, wzDevices);
  expect(out.changed).toBe(false);
  expect(out.registry).toBe(notLoaded);

  // A stored *empty* document is still authoritative: it carries an updatedAt.
  const emptied = { version: 0, updatedAt: Date.now(), pages: [] };
  expect(migratePageRegistry(emptied, wzDevices).changed).toBe(true);
});

// ------------------------------------------------------- resolving placements
// Task 3: the display walks a section's placements, not its filter.

it("resolves a page from its placement lists, in order, skipping dangling devices", () => {
  const page: Page = {
    id: "p",
    title: "P",
    groups: [
      {
        id: "g",
        tiles: [
          { id: "t1", device: "b" },
          { id: "t2", device: "gone" },
          { id: "t3", device: "a" },
        ],
      },
    ],
  };
  const res = resolvePage(page, [dev({ id: "a" }), dev({ id: "b" })]);
  expect(res[0].tiles.map((t) => t.device.id)).toEqual(["b", "a"]);
  expect(res[0].tiles.map((t) => t.placement.id)).toEqual(["t1", "t3"]);
});

it("shows the same device in two sections (no claiming)", () => {
  const page: Page = {
    id: "p",
    title: "P",
    groups: [
      { id: "g1", tiles: [{ id: "t1", device: "a" }] },
      { id: "g2", tiles: [{ id: "t2", device: "a" }] },
    ],
  };
  expect(resolvePage(page, [dev({ id: "a" })])).toHaveLength(2);
});

it("keeps an empty placement list invisible unless showEmpty", () => {
  const page: Page = {
    id: "p",
    title: "P",
    groups: [
      { id: "g1", tiles: [] },
      { id: "g2", tiles: [], showEmpty: true },
    ],
  };
  const res = resolvePage(page, [dev({})]);
  expect(res.map((r) => r.group.id)).toEqual(["g2"]);
});

it("the display's placeholder distinguishes connecting, unreadable and empty", () => {
  // not connected yet, or connected but the document is still on its way
  expect(pagePlaceholder(false, null)).toBe("connecting");
  expect(pagePlaceholder(false, "invalid")).toBe("connecting");
  expect(pagePlaceholder(true, null)).toBe("connecting");
  // the read came back empty-handed: that is not "no pages", it is not read
  expect(pagePlaceholder(true, "absent")).toBe("unreadable");
  expect(pagePlaceholder(true, "invalid")).toBe("unreadable");
  // really no pages: the document loaded (or was seeded) and holds none
  expect(pagePlaceholder(true, "loaded")).toBe("none");
  expect(pagePlaceholder(true, "seeded")).toBe("none");
});
