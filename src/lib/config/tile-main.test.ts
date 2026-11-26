import { expect, it } from "vitest";
import { setMainSlotSource } from "$lib/config/tile-main";
import type { TileConfig } from "$lib/types/display";

const source = (stateId: string) => ({ kind: "state" as const, stateId });

const tile = (): TileConfig => ({
  slots: [
    {
      kind: "switch",
      source: source("alias.0.A.SET"),
      label: "Power",
    },
    { kind: "badge", source: "ago" },
  ],
  active: { source: source("alias.0.A.SET"), op: "truthy" },
});

it("retargets an active condition that was following the old main state", () => {
  const next = setMainSlotSource(tile(), 0, source("alias.0.B.SET"));
  expect(next.active?.source).toEqual(source("alias.0.B.SET"));
  expect(next.active?.op).toBe("truthy");
});

it("keeps an independently chosen active source", () => {
  const before: TileConfig = {
    ...tile(),
    active: { source: source("alias.0.C.SET"), op: "eq", value: "on" },
  };
  const next = setMainSlotSource(before, 0, source("alias.0.B.SET"));
  expect(next.active).toEqual({
    source: source("alias.0.C.SET"),
    op: "eq",
    value: "on",
  });
});

it("does not touch the active condition when another slot changes", () => {
  const next = setMainSlotSource(tile(), 1, "offline");
  expect(next.active).toEqual(tile().active);
});

it("does not invent an active condition", () => {
  const before: TileConfig = { ...tile(), active: undefined };
  const next = setMainSlotSource(before, 0, source("alias.0.B.SET"));
  expect(next.active).toBeUndefined();
});

it("keeps a string main source in the active condition", () => {
  const next = setMainSlotSource(tile(), 0, "alias.0.B.SET");
  expect(next.active?.source).toBe("alias.0.B.SET");
});
