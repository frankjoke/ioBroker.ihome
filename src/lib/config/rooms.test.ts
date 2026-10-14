import { it, expect } from "vitest";
import {
  roomForState,
  roomsOf,
  functionsOf,
  favoritesOf,
  enumShortId,
  enumLabelFromObject,
  enumLabel,
  roomName,
  findEnum,
} from "$lib/config/rooms";

it("finds an enum object by id across all enum lists", () => {
  const enums: any = {
    list: {
      rooms: [{ _id: "enum.rooms.Bad", common: { name: "Bad" } }],
      functions: [],
    },
  };
  expect(findEnum(enums, "enum.rooms.Bad")?.common.name).toBe("Bad");
});
it("returns undefined when the enum is not found", () => {
  expect(findEnum({ list: {} }, "enum.rooms.X")).toBeUndefined();
});

it("returns the room name, falling back to the short id", () => {
  const enums: any = {
    getList: () => [{ _id: "enum.rooms.Bad", common: { name: "Bad" } }],
  };
  expect(roomName(enums, "enum.rooms.Bad")).toBe("Bad");
  expect(roomName({ getList: () => [] }, "enum.rooms.Bad")).toBe("Bad");
});

it("strips the enum type prefix from an id", () => {
  expect(enumShortId("enum.rooms.SchlafzimmerFranz")).toBe("SchlafzimmerFranz");
  expect(enumShortId("enum.functions.Licht.Wohnzimmer")).toBe(
    "Licht.Wohnzimmer",
  );
});
it("formats an enum object as name (shortId)", () => {
  expect(
    enumLabelFromObject({
      _id: "enum.rooms.SchlafzimmerFranz",
      common: { name: "SZFranz" },
    }),
  ).toBe("SZFranz (SchlafzimmerFranz)");
});
it("uses just the short id when the name is missing or equal", () => {
  expect(enumLabelFromObject({ _id: "enum.rooms.X", common: {} })).toBe("X");
});
it("resolves a room label from the enum list", () => {
  const enums: any = {
    getList: () => [{ _id: "enum.rooms.X", common: { name: "SZFranz" } }],
  };
  expect(enumLabel(enums, "enum.rooms.X", "rooms")).toBe("SZFranz (X)");
});
it("returns a non-enum string unchanged", () => {
  const enums: any = { getList: () => [] };
  expect(enumLabel(enums, "Wohnzimmer", "rooms")).toBe("Wohnzimmer");
});

it("finds a room on a parent folder when the state has none", () => {
  const enums: any = {
    get: (id: string) =>
      id === "alias.0.1Stock.FSZLampe"
        ? { rooms: [{ _id: "enum.rooms.living" }] }
        : undefined,
  };
  expect(roomForState(enums, "alias.0.1Stock.FSZLampe.SET")).toBe(
    "enum.rooms.living",
  );
});

it("prefers the state's own room over a parent's", () => {
  const enums: any = {
    get: (id: string) =>
      id === "alias.0.x"
        ? { rooms: [{ _id: "enum.rooms.kitchen" }] }
        : id === "alias.0"
          ? { rooms: [{ _id: "enum.rooms.living" }] }
          : undefined,
  };
  expect(roomForState(enums, "alias.0.x")).toBe("enum.rooms.kitchen");
});

it("returns undefined when no room is found anywhere", () => {
  const enums: any = { get: () => undefined };
  expect(roomForState(enums, "alias.0.a.b.c")).toBeUndefined();
});

it("reads any enum type off a member id", () => {
  const enums: any = {
    get: (id: string) =>
      ({
        "alias.0.EG.Light": {
          rooms: [{ _id: "enum.rooms.WZ" }],
          functions: [{ _id: "enum.functions.Licht" }],
          favorites: [{ _id: "enum.favorites.EG" }],
        },
        "alias.0.EG.Plug": {
          functions: [{ _id: "enum.functions.Licht" }],
          favorites: [],
        },
      })[id],
  };
  expect(roomsOf(enums, "alias.0.EG.Light")).toEqual(["enum.rooms.WZ"]);
  expect(functionsOf(enums, "alias.0.EG.Light")).toEqual([
    "enum.functions.Licht",
  ]);
  expect(favoritesOf(enums, "alias.0.EG.Light")).toEqual(["enum.favorites.EG"]);
  expect(favoritesOf(enums, "alias.0.EG.Plug")).toEqual([]);
  expect(favoritesOf(enums, "alias.0.Missing")).toEqual([]);
});
