import { it, expect } from "vitest";
import { sortDevices } from "$lib/config/sort";

const mk = (name: string, room: string, type: string) =>
  ({ id: name, name, type, room, controls: [] }) as any;

it("sorts by name ascending and descending", () => {
  const d = [mk("Banana", "", "Switch"), mk("apple", "", "Switch")];
  expect(sortDevices(d, "name", "asc").map((x) => x.name)).toEqual([
    "apple",
    "Banana",
  ]);
  expect(sortDevices(d, "name", "desc").map((x) => x.name)).toEqual([
    "Banana",
    "apple",
  ]);
});
it("sorts by type", () => {
  const d = [mk("x", "", "Switch"), mk("y", "", "Light")];
  expect(sortDevices(d, "type", "asc").map((x) => x.type)).toEqual([
    "Light",
    "Switch",
  ]);
});
it("sorts by room using the injected label resolver", () => {
  const d = [
    mk("a", "enum.rooms.Z", "Value"),
    mk("b", "enum.rooms.A", "Value"),
  ];
  const label = (x: any) => (x.room === "enum.rooms.Z" ? "Bad" : "Wohnzimmer");
  expect(sortDevices(d, "room", "asc", label).map((x) => x.room)).toEqual([
    "enum.rooms.Z",
    "enum.rooms.A",
  ]);
});
it("does not mutate the input array", () => {
  const d = [mk("B", "", "Switch"), mk("A", "", "Switch")];
  sortDevices(d, "name", "asc");
  expect(d.map((x) => x.name)).toEqual(["B", "A"]);
});
