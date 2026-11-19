import { it, expect } from "vitest";
import {
  CHART_PALETTE,
  binaryOn,
  hasHistory,
  faceDefaultGlyph,
  faceGlyph,
  faceSwitchRow,
  headerIcon,
  headlineSlot,
  labelShown,
  rowIcon,
  rowSpark,
  singleSurface,
  stateLook,
  tileHeadlineSlot,
  tileParts,
  tileSeries,
  tileSourceControls,
  valueShown,
  type SlotRow,
} from "$lib/config/tile-parts";
import type {
  EnrichedControl,
  EnrichedDevice,
  SlotControl,
} from "$lib/types/device";
import type { Slot, Template, TileConfig, TileLook } from "$lib/types/display";
import { blankDevice } from "$lib/config/blank-tile";
import { TEMPERATURE_ICON } from "$lib/config/presets";
import { resolveTile } from "$lib/config/tile-resolve";
import { resolveBadges, ruleScope } from "$lib/config/rule-ops";
import type { SourceOverride } from "$lib/types/overrides";

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

const tile = (slots: Slot[], over: Partial<TileConfig> = {}): TileConfig => ({
  slots,
  ...over,
});
const none: Template[] = [];
const noRaw = (): SlotControl | undefined => undefined;

/** One repair override, as the registry stores it. */
const repair = (
  id: string,
  stateId: string,
  name: string,
  over: Partial<SourceOverride> = {},
): SourceOverride => ({ id, stateId, kind: "repair", name, ...over });

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

it("a rule-hidden modal slot still gets its detail row", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "value",
        source: "humidity",
        where: "modal",
        rules: [{ when: "true", hidden: true, color: "var(--danger-color)" }],
      },
    ]),
    none,
  );
  // Detail mode is the tile settings' business: rules do not hide, colour or
  // icon a row there.
  expect(parts.modal.map((r) => r.slot.source)).toEqual(["humidity"]);
  expect(parts.modal[0].style).toEqual({});
  expect(parts.hasModal).toBe(true);
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

it("an html slot passes through and is never the tile face", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "html",
        options: { html: "<h1>Hello</h1>" },
        where: "modal",
      },
    ]),
    none,
  );
  expect(parts.modal[0].control).toBeUndefined();
  const value: Slot = { kind: "value", source: "temperature" };
  expect(headlineSlot([{ kind: "html" }, value])).toBe(value);
});

it("a writable state source yields a switch row", () => {
  const stateId = "0_userdata.0.x";
  const resolution = resolveTile(
    { slots: [{ kind: "switch", source: { kind: "state", stateId } }] },
    "Lamp",
    {
      devices: [],
      states: new Map([[stateId, { val: false }]]),
      objects: new Map([
        [stateId, { common: { name: "Lamp", type: "boolean", write: true } }],
      ]),
    },
  );
  const parts = tileParts(resolution.device, resolution.tile, none);
  expect(parts.rows).toHaveLength(1);
  expect(parts.rows[0].control).toMatchObject({
    widget: "switch",
    writable: true,
    stateId,
    liveValue: false,
  });
});

it("a device badge reports only the device it names", () => {
  const stateId = "dev.0.state";
  const make = (available: boolean, derive?: "ago") => {
    const resolution = resolveTile(
      {
        slots: [
          {
            kind: "badge",
            source: { kind: "device", device: "dev" },
            ...(derive ? { options: { derive } } : {}),
          },
        ],
      },
      "Dev",
      {
        devices: [
          {
            id: "dev",
            name: "Dev",
            type: "Switch",
            available,
            exists: true,
            controls: [
              {
                id: "c1",
                feature: "power",
                stateId,
                writable: true,
                available,
                exists: true,
              },
            ],
          } as unknown as EnrichedDevice,
        ],
        states: new Map([[stateId, { val: false, ts: 1000 }]]),
        objects: new Map([[stateId, { common: {} }]]),
      },
    );
    return {
      resolution,
      parts: tileParts(resolution.device, resolution.tile, none),
    };
  };

  const offline = make(false);
  expect(offline.parts.badgeSlots[0].source).toBe("offline");
  expect(offline.parts.badgeSlots[0].options?.of).toBe("slot:0");
  expect(
    resolveBadges(
      offline.parts.badgeSlots,
      offline.resolution.device,
      { at: () => undefined },
      2000,
    ).map((b) => b.source),
  ).toEqual(["offline"]);

  const online = make(true);
  expect(
    resolveBadges(
      online.parts.badgeSlots,
      online.resolution.device,
      { at: () => undefined },
      2000,
    ),
  ).toEqual([]);

  const ago = make(true, "ago");
  const badges = resolveBadges(
    ago.parts.badgeSlots,
    ago.resolution.device,
    { at: (source) => (source === "slot:0" ? 1000 : undefined) },
    2000,
  );
  expect(badges.map((b) => b.source)).toEqual(["ago"]);
});

it("a blank tile does not inherit the preset chain", () => {
  const parts = tileParts(blankDevice(), undefined, []);
  expect(parts.slots).toEqual([]);
  expect(parts.rows).toEqual([]);
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

it("a badge in the detail counts as modal content, resolved or not", () => {
  // Without a resolver the sheet still gets a yes — it asks about content, not
  // about what a chip would say.
  const asked = tileParts(
    device(),
    tile([{ kind: "badge", source: "offline", detail: "full" }]),
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
    tile([{ kind: "badge", source: "offline", detail: "full" }]),
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

it("a tile-active rule does not remove the detail row", () => {
  const t = tile([
    {
      kind: "value",
      source: "humidity",
      where: "modal",
      rules: [{ when: "active", hidden: true }],
    },
  ]);
  // Detail mode follows the slot's Detail span, not the tile's active rules.
  expect(tileParts(device(), t, none).hasModal).toBe(true);
  expect(tileParts(device(), t, none, { active: true }).hasModal).toBe(true);
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

it("picks the headline: the first face slot, never a badge or frame", () => {
  // The first real slot is the face, even when a value follows it: a switch
  // keeps the main icon on the first slot instead of handing it to the value.
  const button: Slot = { kind: "button" };
  const value: Slot = { kind: "value", source: "humidity", where: "modal" };
  expect(headlineSlot([{ kind: "badge" }, button, value])).toBe(button);
  expect(headlineSlot([{ kind: "frame" }, value])).toBe(value);
  expect(headlineSlot([value, button])).toBe(value);

  // With no face-kind, the first non-badge/non-frame, else the first slot.
  const badge: Slot = { kind: "badge" };
  expect(headlineSlot([badge, { kind: "frame" }])).toBe(badge);
  expect(headlineSlot([])).toBeUndefined();
});

it("does not make a badge-mode value the tile face", () => {
  const valueBadge: Slot = { kind: "value", source: "humidity", tile: "badge" };
  const button: Slot = { kind: "button" };
  expect(tileHeadlineSlot([valueBadge, button])).toBe(button);
  expect(tileHeadlineSlot([valueBadge])).toBe(valueBadge);
});

it("moves a badge-mode slot to the corner, keeping its detail row", () => {
  const t = tile([
    { kind: "value", source: "temperature" },
    { kind: "value", source: "humidity", tile: "badge", detail: "full" },
  ]);
  const parts = tileParts(device(), t, none);
  expect(parts.body.map((r) => r.slot.source)).toEqual(["temperature"]);
  expect(parts.badgeSlots.map((s) => s.source)).toEqual(["humidity"]);
  expect(parts.modal.map((r) => r.slot.source)).toEqual(["humidity"]);
  expect(tileHeadlineSlot(t.slots!)).toBe(t.slots![0]);
});

it("an only gate hides the badge but keeps its detail row", () => {
  const t = tile([
    {
      kind: "value",
      source: "humidity",
      tile: "badge",
      detail: "full",
      icon: { glyph: "battery" },
      rules: [
        {
          when: "false",
          only: true,
          color: "var(--surface-color)",
          background: "var(--danger-color)",
        },
      ],
    },
  ]);
  const parts = tileParts(device(), t, none);
  // The gate hides it on the tile; the detail list is governed by the Detail
  // span alone, so its row stays and no rule reaches its icon.
  expect(parts.badgeSlots).toHaveLength(1);
  expect(parts.modal.map((r) => r.slot.source)).toEqual(["humidity"]);
  const row = parts.modal[0];
  expect(row.style).toEqual({});
  expect(rowIcon(row, "modal")).toEqual({ glyph: "battery", color: undefined });
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

it("a found device icon stands in for a template's glyph (A67)", () => {
  // The chain's own slots: their glyph is the template's, so the device's
  // found icon takes over…
  const chain = tileParts(
    device({ controls: [control("c1", "temperature")] }),
    undefined,
    none,
  );
  const head = chain.rows.find((r) => r.slot.icon?.glyph === TEMPERATURE_ICON);
  expect(head?.iconIsTemplate).toBe(true);
  expect(rowIcon(head!, "tile", "https://x/dev.png")?.glyph).toBe(
    "https://x/dev.png",
  );
  // …a glyph of the user's own keeps standing…
  const own = tileParts(
    device({ controls: [control("c1", "temperature")] }),
    tile([
      { kind: "value", source: "temperature", icon: { glyph: "water_drop" } },
    ]),
    none,
  );
  expect(own.rows[0].iconIsTemplate).toBe(false);
  expect(rowIcon(own.rows[0], "tile", "https://x/dev.png")?.glyph).toBe(
    "water_drop",
  );
  // …and a rule's icon still wins (A51/A58).
  const ruled = tileParts(
    device({ controls: [control("c1", "temperature")] }),
    tile([
      {
        kind: "value",
        source: "temperature",
        icon: { glyph: "device_thermostat" },
        rules: [{ when: "true", icon: "bolt" }],
      },
    ]),
    none,
  );
  expect(rowIcon(ruled.rows[0], "tile", "https://x/dev.png")?.glyph).toBe(
    "bolt",
  );
  // With no found icon, the template's own glyph stays.
  expect(rowIcon(head!, "tile")?.glyph).toBe(TEMPERATURE_ICON);
});

const withHistory = (id: string, feature: string) =>
  ({
    ...control(id, feature),
    history: { duration: 24, durationUnit: "hours" },
  }) as EnrichedControl;

it("lists every resolved row exactly once, whatever its home", () => {
  const parts = tileParts(
    device(),
    tile([
      { kind: "value", source: "temperature" },
      { kind: "value", source: "humidity", where: "both" },
      { kind: "value", source: "temperature", where: "modal" },
    ]),
    none,
  );
  expect(parts.rows.length).toBe(3);
  expect(parts.body.length).toBe(2);
  expect(parts.modal.length).toBe(2);
});

it("charts only a value whose control has history, in slot order (A61)", () => {
  const dev = device({
    controls: [withHistory("c1", "temperature"), control("c2", "humidity")],
  });
  const parts = tileParts(
    dev,
    tile([
      { kind: "value", source: "temperature", spark: {} },
      { kind: "value", source: "humidity", spark: {} },
    ]),
    none,
  );
  expect(parts.rows.length).toBe(2);
  expect(hasHistory(parts.rows[0].control)).toBe(true);
  expect(hasHistory(parts.rows[1].control)).toBe(false);
  expect(hasHistory(undefined)).toBe(false);

  const series = tileSeries(parts.rows);
  expect(series.map((s) => s.control.id)).toEqual(["c1"]);
  expect(series[0].slot.source).toBe("temperature");
  expect(series[0].color).toBe(CHART_PALETTE[0]);
});

it("honours the soft off, an own colour and the chart's own home (A59/A60)", () => {
  const dev = device({ controls: [withHistory("c1", "temperature")] });
  const modalRow = tileParts(
    dev,
    tile([{ kind: "value", source: "temperature", where: "modal", spark: {} }]),
    none,
  );
  // A60: a modal-only row still charts the tile.
  expect(tileSeries(modalRow.rows).map((s) => s.control.id)).toEqual(["c1"]);
  expect(rowSpark(modalRow.rows, modalRow.rows[0], "modal")?.control.id).toBe(
    "c1",
  );

  const off = tileParts(
    dev,
    tile([{ kind: "value", source: "temperature", spark: { enabled: false } }]),
    none,
  );
  expect(tileSeries(off.rows)).toEqual([]);
  expect(rowSpark(off.rows, off.rows[0], "modal")).toBeUndefined();

  const own = tileParts(
    dev,
    tile([
      { kind: "value", source: "temperature", spark: { color: "#123456" } },
    ]),
    none,
  );
  expect(tileSeries(own.rows)[0].color).toBe("#123456");

  const tileOnly = tileParts(
    dev,
    tile([{ kind: "value", source: "temperature", spark: { where: "tile" } }]),
    none,
  );
  expect(tileSeries(tileOnly.rows).length).toBe(1);
  expect(rowSpark(tileOnly.rows, tileOnly.rows[0], "modal")).toBeUndefined();
});

it("gives a series the palette colour of its place among the charting values (A61)", () => {
  const dev = device({
    controls: [withHistory("c1", "temperature"), withHistory("c2", "humidity")],
  });
  const parts = tileParts(
    dev,
    tile([
      { kind: "value", source: "temperature", spark: { where: "modal" } },
      { kind: "value", source: "humidity", spark: {} },
    ]),
    none,
  );
  // The modal-only value keeps palette[0]; the tile series takes palette[1].
  expect(rowSpark(parts.rows, parts.rows[0], "modal")?.color).toBe(
    CHART_PALETTE[0],
  );
  expect(tileSeries(parts.rows)[0].color).toBe(CHART_PALETTE[1]);
});

it("never charts a row that resolved no control (A63)", () => {
  const parts = tileParts(
    device(),
    tile([{ kind: "value", source: "nowhere", spark: {} }]),
    none,
  );
  expect(parts.rows).toEqual([]);
  expect(tileSeries(parts.rows)).toEqual([]);
  // A control with history but no state cannot chart either (A63).
  expect(
    hasHistory({
      history: { duration: 1, durationUnit: "hours" },
    } as SlotControl),
  ).toBe(false);
});

it("charts only the rows the tile resolves (A60): a hidden row takes its chart with it", () => {
  const dev = device({ controls: [withHistory("c1", "temperature")] });
  const parts = tileParts(
    dev,
    tile([
      {
        kind: "value",
        source: "temperature",
        spark: {},
        rules: [{ when: "true", hidden: true }],
      },
    ]),
    none,
  );
  expect(parts.rows.length).toBe(0);
  expect(tileSeries(parts.rows)).toEqual([]);

  const shown = tileParts(
    dev,
    tile([{ kind: "value", source: "temperature", spark: {} }]),
    none,
  );
  expect(tileSeries(shown.rows).length).toBe(1);
});

it("reads a tile's state look, the inactive one as its default (A71)", () => {
  const look: TileLook = {
    active: { glow: "var(--success-color)", color: "#ff0", glyph: "bolt" },
    inactive: { background: { kind: "solid", value: "#111" } },
  };
  const on = (extra: Partial<TileConfig> = {}): TileConfig => ({
    slots: [],
    active: { source: "power", op: "truthy" },
    look,
    ...extra,
  });
  expect(stateLook(on(), true)).toEqual(look.active);
  expect(stateLook(on(), false)).toEqual(look.inactive);
  // No condition → the inactive look still styles the tile, but its glyph is
  // not the face; the tile's own icon is.
  expect(stateLook({ slots: [], look }, true)).toEqual(look.inactive);
  expect(stateLook({ slots: [], look }, false)).toEqual(look.inactive);
  const glyphOnly = {
    inactive: { glyph: "door_locked", color: "#fff" },
  };
  expect(stateLook({ slots: [], look: glyphOnly }, true)).toEqual({
    color: "#fff",
  });
  expect(stateLook(undefined, true)).toEqual({});
  // The state without its own entry keeps the rules.
  expect(stateLook(on({ look: { active: look.active } }), false)).toEqual({});
});

it("finds the switch/button a face tap should run", () => {
  const row = (kind: Slot["kind"], widget: string, writable = true) =>
    ({ slot: { kind }, control: { widget, writable } }) as unknown as SlotRow;
  const headline = row("value", "value");
  const headSwitch = row("switch", "switch");
  const shownSwitch = row("switch", "switch");
  const button = row("button", "button");
  expect(faceSwitchRow([headline, shownSwitch, button], headline)).toBe(
    shownSwitch,
  );
  expect(faceSwitchRow([headline, shownSwitch], headSwitch)).toBe(headSwitch);
  expect(faceSwitchRow([headline], headline)).toBeUndefined();
  const hiddenIcon = row("switch", "switch");
  hiddenIcon.slot.icon = { glyph: "power_settings_new", where: "modal" };
  expect(faceSwitchRow([hiddenIcon], undefined)).toBe(hiddenIcon);
  expect(faceSwitchRow([], undefined)).toBeUndefined();
});

it("hides the slot's value off, or moves it by its own home", () => {
  const opts = (over: Record<string, unknown> = {}) => ({ ...over });
  // Absent = both.
  expect(valueShown(undefined, "tile")).toBe(true);
  expect(valueShown(opts(), "modal")).toBe(true);
  // The off switch wins over any home.
  expect(valueShown(opts({ hideValue: true }), "tile")).toBe(false);
  expect(
    valueShown(opts({ hideValue: true, valueWhere: "modal" }), "modal"),
  ).toBe(false);
  // Home: tile-only and modal-only; unknown values fall back to both.
  expect(valueShown(opts({ valueWhere: "tile" }), "tile")).toBe(true);
  expect(valueShown(opts({ valueWhere: "tile" }), "modal")).toBe(false);
  expect(valueShown(opts({ valueWhere: "modal" }), "tile")).toBe(false);
  expect(valueShown(opts({ valueWhere: "modal" }), "modal")).toBe(true);
  expect(valueShown(opts({ valueWhere: "elsewhere" }), "tile")).toBe(true);
});

it("draws a slot's name where its labelWhere says", () => {
  // Absent puts every name in the detail view: only the tile's title is on the
  // face. A frame's caption is a slot name too, so it waits for an explicit home.
  expect(labelShown({ kind: "value" }, "modal")).toBe(true);
  expect(labelShown({ kind: "value" }, "tile")).toBe(false);
  expect(labelShown({ kind: "frame" }, "tile")).toBe(false);
  expect(labelShown({ kind: "frame" }, "modal")).toBe(true);
  expect(labelShown({ kind: "html" }, "tile")).toBe(false);
  // An explicit home wins on either side.
  expect(labelShown({ kind: "value", labelWhere: "tile" }, "tile")).toBe(true);
  expect(labelShown({ kind: "value", labelWhere: "tile" }, "modal")).toBe(
    false,
  );
  expect(labelShown({ kind: "value", labelWhere: "both" }, "tile")).toBe(true);
  expect(labelShown({ kind: "value", labelWhere: "modal" }, "modal")).toBe(
    true,
  );
  // A frame caption can go on the face too.
  expect(labelShown({ kind: "frame", labelWhere: "both" }, "tile")).toBe(true);
});

it("the tile icon is separate from the headline slot icon", () => {
  // Face: state look → tile icon → headline slot icon.
  expect(faceGlyph({ glyph: "look" }, "tile", "slot")).toBe("look");
  expect(faceGlyph({}, "tile", "slot")).toBe("tile");
  expect(faceGlyph({}, undefined, "slot")).toBe("slot");
  // Header: state look → tile icon → headline slot icon → device icon.
  expect(
    headerIcon("tile", { glyph: "look" }, { glyph: "slot" }, "device"),
  ).toEqual({ glyph: "look" });
  expect(
    headerIcon(undefined, { glyph: "look", color: "red" }, { glyph: "slot" }),
  ).toEqual({ glyph: "look", color: "red" });
  expect(headerIcon(undefined, {}, { glyph: "slot" })).toEqual({
    glyph: "slot",
  });
  expect(headerIcon(undefined, {}, undefined, "device")).toEqual({
    glyph: "device",
  });
  expect(headerIcon(undefined, {})).toBeUndefined();
});

it("treats a lone frame or html slot as a full surface", () => {
  expect(singleSurface([{ kind: "frame" }])).toBe(true);
  expect(singleSurface([{ kind: "html" }])).toBe(true);
  expect(singleSurface([{ kind: "value" }])).toBe(false);
  expect(singleSurface([{ kind: "frame" }, { kind: "value" }])).toBe(false);
  expect(singleSurface([])).toBe(false);
});

it("reads a control's binary state", () => {
  const state = (liveValue: unknown, meta?: Record<string, unknown>) =>
    binaryOn({ liveValue, meta } as SlotControl);
  expect(state(true)).toBe(true);
  expect(state(false)).toBe(false);
  expect(state(1, { type: "number", min: 0, max: 1 })).toBe(true);
  expect(state(0, { type: "number", min: 0, max: 1 })).toBe(false);
  expect(state(1)).toBeUndefined();
  expect(state("1")).toBeUndefined();
  expect(state(2, { type: "number", min: 0, max: 1 })).toBeUndefined();
  expect(state(undefined)).toBeUndefined();
});

it("switches a row icon with its twin from the row's own state", () => {
  const twins = { "bulb-off": "bulb-on" };
  const row = (liveValue: unknown, glyph = "bulb-off"): SlotRow => ({
    slot: { kind: "value", source: "s", icon: { glyph } },
    control: { liveValue, meta: { type: "boolean" } },
    style: {},
  });
  expect(rowIcon(row(true), "tile", undefined, twins)?.glyph).toBe("bulb-on");
  expect(rowIcon(row(false), "tile", undefined, twins)?.glyph).toBe("bulb-off");
  // the on half is drawn when that is what the document picked
  expect(rowIcon(row(true, "bulb-on"), "modal", undefined, twins)?.glyph).toBe(
    "bulb-on",
  );
  expect(rowIcon(row(false, "bulb-on"), "modal", undefined, twins)?.glyph).toBe(
    "bulb-off",
  );
  // no twin or no twins map: unchanged
  expect(rowIcon(row(true), "tile", undefined)?.glyph).toBe("bulb-off");
  expect(rowIcon(row(1), "tile", undefined, twins)?.glyph).toBe("bulb-off");
});

it("falls back to a role icon for a bare row, but not for a disabled one", () => {
  const bare: SlotRow = { slot: { kind: "value", source: "s" }, style: {} };
  expect(rowIcon(bare, "tile", undefined, undefined, "water_drop")?.glyph).toBe(
    "water_drop",
  );
  const on: SlotRow = {
    ...bare,
    control: { liveValue: true, meta: { type: "boolean" } },
  };
  expect(rowIcon(on, "tile", undefined, { a: "b" }, "a")?.glyph).toBe("b");
  const disabled: SlotRow = {
    slot: { kind: "value", source: "s", icon: { glyph: "x", enabled: false } },
    style: {},
  };
  expect(
    rowIcon(disabled, "tile", undefined, undefined, "water_drop"),
  ).toBeUndefined();
});

it("orders the face: look, tile, slot, default, device", () => {
  expect(faceGlyph({}, undefined, undefined, "thermostat", "object.png")).toBe(
    "thermostat",
  );
  expect(faceGlyph({}, undefined, undefined, undefined, "object.png")).toBe(
    "object.png",
  );
  expect(faceGlyph({ glyph: "look" }, "tile", "slot", "def", "obj")).toBe(
    "look",
  );
});

it("suppresses the face default for an active, disabled or device-owned face", () => {
  const headline: Slot = { kind: "value", source: "s" };
  expect(
    faceDefaultGlyph({ hasActive: false, headline, poolValue: "def" }),
  ).toBe("def");
  expect(
    faceDefaultGlyph({ hasActive: true, headline, poolValue: "def" }),
  ).toBeUndefined();
  expect(
    faceDefaultGlyph({
      hasActive: false,
      headline: { ...headline, icon: { enabled: false } },
      poolValue: "def",
    }),
  ).toBeUndefined();
  expect(
    faceDefaultGlyph({
      hasActive: false,
      headline,
      deviceOwnIcon: "own",
      poolValue: "def",
    }),
  ).toBeUndefined();
});

it("a detail badge mirrors the tile's rule and label", () => {
  const unreachable = device({
    controls: [control("c1", "temperature", false)],
  });
  const parts = tileParts(
    unreachable,
    tile([
      {
        kind: "badge",
        source: "offline",
        detail: "full",
        options: { badgeLabel: false },
        rules: [{ when: "true", color: "var(--danger-color)" }],
      },
    ]),
    none,
    { raw: noRaw },
  );
  expect(parts.modalBadges.map((badge) => badge.source)).toEqual(["offline"]);
  expect(parts.modalBadges[0].color).toBe("var(--danger-color)");
  // Like the tile, an icon-only chip stays icon-only in the detail header.
  expect(parts.modalBadges[0].labelHidden).toBe(true);
});

it("a detail badge hidden on the tile leaves the header", () => {
  const unreachable = device({
    controls: [control("c1", "temperature", false)],
  });
  const parts = tileParts(
    unreachable,
    tile([
      {
        kind: "badge",
        source: "offline",
        detail: "full",
        rules: [{ when: "true", hidden: true }],
      },
    ]),
    none,
    { raw: noRaw },
  );
  expect(parts.modalBadges).toEqual([]);
});

// ------------------------------------------------------- override rule scope

it("builds a rule local from a slot's override", () => {
  const controls = tileSourceControls(
    [
      {
        kind: "value",
        source: { kind: "state", stateId: "s", override: "o" },
      },
    ],
    {
      overrides: [repair("o", "s", "power", { label: "Leistung" })],
      states: new Map([["s", { val: 7 }]]),
    },
  );
  expect(controls).toHaveLength(1);
  // The rule writes the override's name; its label is only the display label.
  expect(controls[0]).toMatchObject({
    feature: "power",
    label: "Leistung",
    liveValue: 7,
  });
});

it("keeps a control source working until the migration", () => {
  const dev = device({
    controls: [{ ...control("c1", "temperature"), liveValue: 21 }],
  });
  const byControl = tileSourceControls(
    [
      {
        kind: "value",
        source: { kind: "control", device: "d1", control: "c1" },
      },
    ],
    { devices: [dev] },
  );
  expect(byControl[0]).toMatchObject({
    feature: "temperature",
    liveValue: 21,
  });
  // A v1 string source resolves through the tile's own control bag.
  const byName = tileSourceControls(
    [{ kind: "value", source: "temperature" }],
    { device: dev },
  );
  expect(byName[0]).toMatchObject({ feature: "temperature", liveValue: 21 });
});

it("appends a watch override without a slot", () => {
  const controls = tileSourceControls([], {
    overrides: [repair("b", "battery", "battery")],
    states: new Map([["battery", { val: 15 }]]),
    watchOverrides: ["b"],
  });
  expect(controls).toHaveLength(1);
  expect(controls[0]).toMatchObject({ feature: "battery", liveValue: 15 });
});

it("suffixes a duplicate override name in the rule scope", () => {
  const controls = tileSourceControls(
    [
      {
        kind: "value",
        source: { kind: "state", stateId: "s1", override: "a" },
      },
      {
        kind: "value",
        source: { kind: "state", stateId: "s2", override: "b" },
      },
    ],
    {
      overrides: [repair("a", "s1", "power"), repair("b", "s2", "power")],
      states: new Map([
        ["s1", { val: 1 }],
        ["s2", { val: 2 }],
      ]),
    },
  );
  const locals = ruleScope(controls, []).locals;
  expect(locals.power).toBe(1);
  expect(locals.power2).toBe(2);
});

it("carries a repair's history on its rule local", () => {
  const history = { duration: 24, durationUnit: "hours" as const };
  const controls = tileSourceControls(
    [{ kind: "value", source: { kind: "state", stateId: "s", override: "o" } }],
    {
      overrides: [repair("o", "s", "power", { history })],
      states: new Map([["s", { val: 7 }]]),
    },
  );
  expect(controls[0].history).toEqual(history);
});

it("a slot rule can name another slot's override", () => {
  const parts = tileParts(
    device(),
    tile([
      {
        kind: "value",
        source: "temperature",
        rules: [{ when: "power > 5", hidden: true }],
      },
      {
        kind: "value",
        source: { kind: "state", stateId: "s", override: "o" },
      },
    ]),
    none,
    {
      overrides: [repair("o", "s", "power")],
      states: new Map([["s", { val: 7 }]]),
    },
  );
  expect(parts.body).toHaveLength(0);
});

it("names a resolved override by its name, not its label", () => {
  const overrides = [repair("o", "s", "power", { label: "Leistung" })];
  const resolution = resolveTile(
    {
      slots: [
        {
          kind: "value",
          source: { kind: "state", stateId: "s", override: "o" },
          rules: [{ when: "power > 5", hidden: true }],
        },
      ],
    },
    "T",
    {
      devices: [],
      states: new Map([["s", { val: 7 }]]),
      objects: new Map(),
      overrides,
    },
  );
  expect(resolution.device.controls[0].feature).toBe("power");
  const parts = tileParts(resolution.device, resolution.tile, none, {
    overrides,
  });
  expect(parts.body).toHaveLength(0);
});

it("keeps a watch override in scope without a slot", () => {
  const overrides = [repair("o", "s", "power"), repair("b", "b", "battery")];
  const states = new Map([
    ["s", { val: 1 }],
    ["b", { val: 15 }],
  ]);
  const resolution = resolveTile(
    {
      slots: [
        {
          kind: "value",
          source: { kind: "state", stateId: "s", override: "o" },
          rules: [{ when: "battery < 20", color: "red" }],
        },
      ],
      watchOverrides: ["b"],
    },
    "T",
    { devices: [], states, objects: new Map(), overrides },
  );
  const parts = tileParts(resolution.device, resolution.tile, none, {
    overrides,
    states,
  });
  expect(parts.body[0].style.color).toBe("red");
});

it("keeps a repaired state charting", () => {
  const history = { duration: 24, durationUnit: "hours" as const };
  const overrides = [repair("o", "s", "power", { history })];
  const resolution = resolveTile(
    {
      slots: [
        {
          kind: "value",
          source: { kind: "state", stateId: "s", override: "o" },
          spark: {},
        },
      ],
    },
    "T",
    {
      devices: [],
      states: new Map([["s", { val: 7 }]]),
      objects: new Map(),
      overrides,
    },
  );
  const parts = tileParts(resolution.device, resolution.tile, none, {
    overrides,
  });
  expect(hasHistory(parts.body[0].control)).toBe(true);
  expect(tileSeries(parts.body).map((s) => s.control.stateId)).toEqual(["s"]);
});

it("a badge rule names a slot's override", () => {
  const unreachable = device({
    controls: [control("c1", "temperature", false)],
  });
  const parts = tileParts(
    unreachable,
    tile([
      {
        kind: "value",
        source: { kind: "state", stateId: "s", override: "o" },
      },
      {
        kind: "badge",
        source: "offline",
        detail: "full",
        rules: [{ when: "power > 5", color: "var(--danger-color)" }],
      },
    ]),
    none,
    {
      raw: noRaw,
      overrides: [repair("o", "s", "power")],
      states: new Map([["s", { val: 7 }]]),
    },
  );
  expect(parts.modalBadges.map((badge) => badge.source)).toEqual(["offline"]);
  expect(parts.modalBadges[0].color).toBe("var(--danger-color)");
});

// The display builds one rule list from the tile's own slots and hands it to
// `tileParts`; these pin that the rows and the badged slots read that list.

it("a derive-ago badge keeps its name in the tile scope", () => {
  const dev = device({
    controls: [
      { ...control("c1", "temperature"), liveValue: 21 },
      { ...control("c2", "connected"), liveValue: "offline" },
    ],
  });
  const slots: Slot[] = [
    {
      kind: "value",
      source: { kind: "control", device: "d1", control: "c1" },
      rules: [{ when: "!isOnline(connected)", hidden: true }],
    },
    {
      kind: "badge",
      source: { kind: "control", device: "d1", control: "c2" },
      options: { derive: "ago" },
    },
  ];
  const resolution = resolveTile({ slots }, "T", {
    devices: [dev],
    states: new Map(),
    objects: new Map(),
  });
  const controls = tileSourceControls(slots, {
    device: resolution.device,
    devices: [dev],
  });
  const parts = tileParts(resolution.device, resolution.tile, none, {
    controls,
  });
  expect(parts.body).toHaveLength(0);
});

it("suffixes names once, so body and corner badges agree", () => {
  const dev = device({
    controls: [
      {
        ...control("c1", "power"),
        label: "Power state",
        liveValue: "offline",
      },
      { ...control("c2", "temperature"), liveValue: 21 },
    ],
  });
  const overrides = [repair("o", "s", "power")];
  const states = new Map([["s", { val: 7 }]]);
  const slots: Slot[] = [
    {
      kind: "badge",
      source: { kind: "control", device: "d1", control: "c1" },
      options: { derive: "ago" },
    },
    {
      kind: "value",
      source: { kind: "state", stateId: "s", override: "o" },
      rules: [{ when: "power === 'offline'", hidden: true }],
    },
  ];
  const resolution = resolveTile({ slots }, "T", {
    devices: [dev],
    states,
    objects: new Map(),
    overrides,
  });
  const controls = tileSourceControls(slots, {
    device: resolution.device,
    devices: [dev],
    states,
    overrides,
  });
  // The badge's `power` comes first, so the override's power becomes `power2`.
  const locals = ruleScope(controls, []).locals;
  expect(locals.power).toBe("offline");
  expect(locals.power2).toBe(7);
  const parts = tileParts(resolution.device, resolution.tile, none, {
    controls,
  });
  expect(parts.body).toHaveLength(0);
});

it("a device badge's name reaches a detail badge's rule", () => {
  const bridge = {
    id: "bridge",
    name: "bridge",
    type: "Switch",
    available: false,
    exists: true,
    controls: [{ ...control("c1", "temperature"), available: false }],
  } as unknown as EnrichedDevice;
  const slots: Slot[] = [
    {
      kind: "badge",
      source: { kind: "device", device: "bridge" },
      detail: "full",
      rules: [{ when: "!isOnline(bridge)", color: "var(--danger-color)" }],
    },
  ];
  const resolution = resolveTile({ slots }, "T", {
    devices: [bridge],
    states: new Map([["c1.state", { val: 1 }]]),
    objects: new Map(),
  });
  const controls = tileSourceControls(slots, {
    device: resolution.device,
    devices: [bridge],
  });
  const parts = tileParts(resolution.device, resolution.tile, none, {
    controls,
    raw: noRaw,
  });
  expect(parts.modalBadges.map((badge) => badge.source)).toEqual(["offline"]);
  expect(parts.modalBadges[0].color).toBe("var(--danger-color)");
});
