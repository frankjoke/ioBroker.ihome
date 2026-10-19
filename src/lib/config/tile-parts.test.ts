import { it, expect } from "vitest";
import { tileParts } from "$lib/config/tile-parts";
import type {
  EnrichedControl,
  EnrichedDevice,
  SlotControl,
} from "$lib/types/device";
import type { Slot, Template, TileConfig } from "$lib/types/display";

const control = (
  id: string,
  feature: string,
  available = true,
): EnrichedControl =>
  ({
    id,
    feature,
    stateId: `${id}.state`,
    label: feature,
    exists: available,
    available,
  }) as EnrichedControl;

const device = (over: Partial<EnrichedDevice> = {}): EnrichedDevice =>
  ({
    id: "d1",
    name: "Sensor",
    type: "Thermometer",
    controls: [control("c1", "temperature"), control("c2", "humidity")],
    ...over,
  }) as EnrichedDevice;

const tile = (slots: Slot[]): TileConfig => ({ slots });
const none: Template[] = [];
const noRaw = (): SlotControl | undefined => undefined;

it("splits the chain's slots by where they live", () => {
  const parts = tileParts(
    device(),
    tile([
      { kind: "value", source: "temperature" },
      { kind: "value", source: "humidity", where: "modal" },
      {
        kind: "frame",
        options: { url: "https://example.test" },
        where: "both",
      },
      { kind: "badge", source: "offline", where: "modal" },
    ]),
    none,
  );
  expect(parts.body.map((r) => r.slot.kind)).toEqual(["value", "frame"]);
  expect(parts.modal.map((r) => r.slot.kind)).toEqual(["value", "frame"]);
  expect(parts.hasModal).toBe(true);
  expect(parts.badgeSlots).toEqual([]);
});

it("a tile-only slot never counts as modal content", () => {
  const parts = tileParts(
    device(),
    tile([{ kind: "value", source: "temperature" }]),
    none,
  );
  expect(parts.modal).toEqual([]);
  expect(parts.hasModal).toBe(false);
});

it("a rule-hidden modal slot is not modal content", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "value",
        source: "humidity",
        where: "modal",
        rules: [{ when: "true", hidden: true }],
      },
    ]),
    none,
  );
  expect(parts.modal).toEqual([]);
  expect(parts.hasModal).toBe(false);
});

it("a frame slot passes through without a control", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "frame",
        options: { url: "https://example.test" },
        where: "both",
      },
    ]),
    none,
  );
  expect(parts.body[0].control).toBeUndefined();
  expect(parts.modal[0].control).toBeUndefined();
});

it("keeps a tile badge in the corners and out of the modal", () => {
  const parts = tileParts(
    device(),
    tile([
      { kind: "value", source: "temperature" },
      { kind: "badge", source: "offline" },
    ]),
    none,
  );
  expect(parts.badgeSlots.map((s) => s.source)).toEqual(["offline"]);
  expect(parts.modalBadges).toEqual([]);
  expect(parts.hasModal).toBe(false);
});

it("a badge only in the modal is modal content, resolved or not", () => {
  // Without a resolver the sheet still gets a yes — it asks about content, not
  // about what a chip would say.
  const asked = tileParts(
    device(),
    tile([{ kind: "badge", source: "offline", where: "modal" }]),
    none,
  );
  expect(asked.modalBadges).toEqual([]);
  expect(asked.hasModal).toBe(true);

  // With one, the chips are the tile's own resolution (an unreachable device).
  const unreachable = device({
    controls: [control("c1", "temperature", false)],
  });
  const resolved = tileParts(
    unreachable,
    tile([{ kind: "badge", source: "offline", where: "modal" }]),
    none,
    { raw: noRaw },
  );
  expect(resolved.modalBadges.map((b) => b.source)).toEqual(["offline"]);
  expect(resolved.hasModal).toBe(true);
});

it("a raw-state modal row counts only when the resolver knows it", () => {
  // The sheet has no resolver of its own; asking it must land on the tile's
  // answer (A47), so the helper is explicit about needing one.
  const t = tile([{ kind: "value", source: "0_userdata.0.x", where: "modal" }]);
  expect(tileParts(device(), t, none).hasModal).toBe(false);

  const raw = (source: string): SlotControl | undefined =>
    source === "0_userdata.0.x"
      ? ({ id: source, stateId: source, label: source } as SlotControl)
      : undefined;
  expect(tileParts(device(), t, none, { raw }).hasModal).toBe(true);
});

it("an active-gated modal row counts only while the tile is not active", () => {
  const t = tile([
    {
      kind: "value",
      source: "humidity",
      where: "modal",
      rules: [{ when: "active", hidden: true }],
    },
  ]);
  expect(tileParts(device(), t, none).hasModal).toBe(true);
  expect(tileParts(device(), t, none, { active: true }).hasModal).toBe(false);
});

it("falls back to the template's own slots when the placement has none", () => {
  const parts = tileParts(device(), undefined, none);
  expect(parts.body.length).toBeGreaterThan(0);
});
