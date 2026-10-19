import { it, expect } from "vitest";
import {
  accentSlot,
  headlineSlot,
  rowIcon,
  tileParts,
} from "$lib/config/tile-parts";
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

it("exposes the very slots its rows carry, chain or materialised (A46/A52)", () => {
  // The headline pick and the row icons compare slot references, so the
  // resolution must hand out the same objects its rows carry — a second
  // `resolveTemplate` call would be a different array.
  const chain = tileParts(device(), undefined, none);
  expect(chain.slots.length).toBeGreaterThan(0);
  expect(chain.body[0]?.slot).toBe(chain.slots[0]);

  const mine = tile([
    { kind: "value", source: "temperature" },
    { kind: "value", source: "humidity" },
  ]);
  const materialised = tileParts(device(), mine, none);
  expect(materialised.slots).toBe(mine.slots);
});

it("picks the headline: the first value slot, else the first non-icon slot", () => {
  // A value anywhere wins, even when it lives only in the modal (A52).
  const value: Slot = {
    kind: "value",
    source: "humidity",
    where: "modal",
  };
  expect(headlineSlot([{ kind: "icon" }, { kind: "button" }, value])).toBe(
    value,
  );

  // Without one, the first slot that is not a legacy icon slot.
  const button: Slot = { kind: "button" };
  expect(headlineSlot([{ kind: "icon" }, button])).toBe(button);
  expect(headlineSlot([])).toBeUndefined();
});

it("wears the legacy icon slot's style while one exists, else the headline's (A52)", () => {
  const legacy: Slot = { kind: "icon", source: "power" };
  const value: Slot = { kind: "value", source: "power", icon: { glyph: "x" } };
  // The legacy pair keeps today's accent exactly: the icon slot wins.
  expect(accentSlot([legacy, value])).toBe(legacy);
  // Once none remains the headline slot wears it.
  expect(accentSlot([value])).toBe(value);
  // A badge first does not become the face while a value slot exists.
  expect(accentSlot([{ kind: "badge" }, value])).toBe(value);
  expect(accentSlot([])).toBeUndefined();
});

it("reads a row's icon from the descriptor, the rule icon winning", () => {
  const parts = tileParts(
    device(),
    tile([{ kind: "value", source: "temperature", icon: { glyph: "x" } }]),
    none,
  );
  expect(rowIcon(parts.body[0], "tile")?.glyph).toBe("x");

  const ruled = tileParts(
    device(),
    tile([
      {
        kind: "value",
        source: "temperature",
        icon: { glyph: "x" },
        rules: [{ when: "true", icon: "y" }],
      },
    ]),
    none,
  );
  expect(rowIcon(ruled.body[0], "tile")?.glyph).toBe("y");

  const bare = tileParts(
    device(),
    tile([{ kind: "value", source: "temperature" }]),
    none,
  );
  expect(rowIcon(bare.body[0], "tile")).toBeUndefined();
});

it("honours enabled and the icon's own homes", () => {
  const row = (slot: Slot) => tileParts(device(), tile([slot]), none).body[0];

  const off = row({
    kind: "value",
    source: "temperature",
    icon: { glyph: "x", enabled: false },
  });
  expect(rowIcon(off, "tile")).toBeUndefined();
  expect(rowIcon(off, "modal")).toBeUndefined();

  const tileOnly = row({
    kind: "value",
    source: "temperature",
    icon: { glyph: "x", where: "tile" },
  });
  expect(rowIcon(tileOnly, "tile")?.glyph).toBe("x");
  expect(rowIcon(tileOnly, "modal")).toBeUndefined();

  const modalOnly = row({
    kind: "value",
    source: "temperature",
    icon: { glyph: "x", where: "modal" },
  });
  expect(rowIcon(modalOnly, "modal")?.glyph).toBe("x");
  expect(rowIcon(modalOnly, "tile")).toBeUndefined();

  // Absent `where` is "both": the icon shows wherever its slot lives.
  const both = row({
    kind: "value",
    source: "temperature",
    icon: { glyph: "x" },
  });
  expect(rowIcon(both, "tile")?.glyph).toBe("x");
  expect(rowIcon(both, "modal")?.glyph).toBe("x");

  const empty = row({
    kind: "value",
    source: "temperature",
    icon: {},
  });
  expect(rowIcon(empty, "tile")).toBeUndefined();
});

it("carries the style's colour and dim into the icon", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "value",
        source: "temperature",
        icon: { glyph: "x" },
        rules: [
          { when: "true", color: "var(--warning-color)", disabled: true },
        ],
      },
    ]),
    none,
  );
  expect(rowIcon(parts.body[0], "tile")).toEqual({
    glyph: "x",
    color: "var(--warning-color)",
    disabled: true,
  });
});
