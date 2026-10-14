import { it, expect } from "vitest";
import {
  AGO_WARN_MS,
  agoBadge,
  evalRule,
  offlineBadge,
  resolveBadges,
  resolveStyle,
  ruleScope,
} from "$lib/config/rule-ops";

const NOW = 1_700_000_000_000;

it("applies the last matching rule", () => {
  const scope = ruleScope(
    [{ feature: "power", label: "Power", liveValue: true }],
    [],
  );
  const style = resolveStyle(
    [
      { when: "!power", color: "grey" },
      { when: "power", color: "amber" },
    ],
    scope,
  );
  expect(style).toEqual({ color: "amber" });
});

it("does not match a broken expression and keeps the tile renderable", () => {
  const scope = ruleScope([{ feature: "power", liveValue: true }], []);
  expect(evalRule({ when: "power >" }, scope)).toBe(false); // Review Focus 3
  expect(evalRule({ when: "nope" }, scope)).toBe(false);
  expect(evalRule({ when: "power" }, scope)).toBe(true);
  expect(resolveStyle([{ when: "power >", color: "red" }], scope)).toEqual({});
});

it("reads raw state ids through the pool helper", () => {
  const scope = ruleScope([], [{ stateId: "alias.0.EG.Relay.SET", value: 1 }]);
  expect(evalRule({ when: "get('alias.0.EG.Relay.SET') > 0" }, scope)).toBe(
    true,
  );
});

it("builds an ago badge and warns after 24h", () => {
  expect(agoBadge(NOW - 1000, NOW)).toEqual({
    source: "ago",
    icon: "schedule",
    tone: "info",
    label: "now",
    title: new Date(NOW - 1000).toLocaleString(),
  });
  expect(agoBadge(NOW - AGO_WARN_MS - 1, NOW)?.tone).toBe("warn");
  expect(agoBadge(NOW - 90_000_000, NOW)?.tone).toBe("warn");
  expect(agoBadge(undefined, NOW)).toBeUndefined();
});

it("builds an offline badge when a state object is missing", () => {
  expect(
    offlineBadge({ controls: [{ available: true }, { available: false }] })
      ?.tone,
  ).toBe("danger");
  expect(offlineBadge({ controls: [{ available: true }] })).toBeUndefined();
  expect(offlineBadge({ controls: [] })).toBeUndefined();
});

it("resolves badge slots and skips ones with no source", () => {
  const badges = resolveBadges(
    [
      { kind: "badge", source: "ago" },
      { kind: "badge", source: "battery" },
      { kind: "badge", source: "nothing" },
    ],
    { controls: [{ available: true, feature: "battery", liveValue: 12 }] },
    NOW - 1000,
    NOW,
  );
  expect(badges.map((b) => b.source)).toEqual(["ago", "battery"]);
  expect(badges[1].label).toBe("12");
  expect(badges[1].tone).toBe("info");
});

it("falls back to info for a junk tone and honours a rule's tone", () => {
  const badges = resolveBadges(
    [
      {
        kind: "badge",
        source: "battery",
        rules: [{ when: "1", tone: "junk" }],
      },
      {
        kind: "badge",
        source: "battery2",
        rules: [{ when: "battery2 < 20", tone: "warn" }],
      },
    ],
    {
      controls: [
        { available: true, feature: "battery", liveValue: 5 },
        { available: true, feature: "battery2", liveValue: 5 },
      ],
    },
    undefined,
    NOW,
  );
  expect(badges[0].tone).toBe("info");
  expect(badges[1].tone).toBe("warn");
});

it("names rule locals after the control feature, not its label", () => {
  const scope = ruleScope(
    [{ feature: "power", label: "Ein/Aus", liveValue: false }],
    [],
  );
  expect(evalRule({ when: "!power" }, scope)).toBe(true);
  // the label stays available too, for formulas already written that way
  expect(evalRule({ when: "ein_aus === false" }, scope)).toBe(true);
});

it("lets a feature local win over another control's label", () => {
  const scope = ruleScope(
    [
      { feature: "state", label: "Power", liveValue: "not the switch" },
      { feature: "power", label: "Leistung", liveValue: true },
    ],
    [],
  );
  // `power` is the feature of the second control, and must not be stolen by the
  // first control's label (which lands on `power2`).
  expect(evalRule({ when: "power === true" }, scope)).toBe(true);
  expect(evalRule({ when: "state === 'not the switch'" }, scope)).toBe(true);
  expect(evalRule({ when: "power2 === 'not the switch'" }, scope)).toBe(true);
});

it("sees virtual readings as locals too", () => {
  const scope = ruleScope(
    [
      {
        kind: "virtual",
        feature: "dewPoint",
        label: "Dew point",
        liveValue: 11.5,
      },
    ],
    [],
  );
  expect(evalRule({ when: "dewPoint < 12" }, scope)).toBe(true);
});

it("normalises on/off values with the truthy helper", () => {
  for (const v of [true, 1, "1", "true"]) {
    const scope = ruleScope([{ feature: "power", liveValue: v }], []);
    expect(evalRule({ when: "truthy(power)" }, scope)).toBe(true);
  }
  for (const v of [false, 0, "0", "false", undefined]) {
    const scope = ruleScope([{ feature: "power", liveValue: v }], []);
    expect(evalRule({ when: "truthy(power)" }, scope)).toBe(false);
  }
});

it("resolves a badge source feature-first and merges control rules", () => {
  const badges = resolveBadges(
    [{ kind: "badge", source: "battery" }],
    {
      controls: [
        { id: "battery", feature: "other", available: true, liveValue: 99 },
        {
          id: "c2",
          feature: "battery",
          available: true,
          liveValue: 8,
          rules: [{ when: "truthy(true)", tone: "warn" }],
        },
      ],
    },
    undefined,
    NOW,
  );
  expect(badges[0].label).toBe("8");
  expect(badges[0].tone).toBe("warn");
});

it("drops ago when the device is offline but keeps offline", () => {
  const badges = resolveBadges(
    [
      { kind: "badge", source: "ago" },
      { kind: "badge", source: "offline" },
    ],
    { controls: [{ id: "c", available: false, liveValue: 1 }] },
    NOW - 60_000,
    NOW,
  );
  expect(badges.map((b) => b.source)).toEqual(["offline"]);
});

it("skips a hidden control's badge", () => {
  const badges = resolveBadges(
    [{ kind: "badge", source: "battery" }],
    {
      controls: [
        {
          id: "c",
          feature: "battery",
          available: true,
          hidden: true,
          liveValue: 8,
        },
      ],
    },
    undefined,
    NOW,
  );
  expect(badges).toEqual([]);
});

it("lets an ago badge name the control it watches", () => {
  const time = {
    at: (source: string | undefined, from: "ts" | "lc") => {
      if (source === "motion")
        return from === "lc" ? NOW - 90_000_000 : NOW - 1000;
      return NOW - 1000; // device-wide newest: a battery just reported
    },
  };
  const motionOnly = resolveBadges(
    [
      {
        kind: "badge",
        source: "ago",
        options: { of: "motion", from: "lc" },
      },
    ],
    {
      controls: [
        { id: "c", feature: "motion", available: true, liveValue: true },
      ],
    },
    time,
    NOW,
  );
  // 25h since the last *motion*, even though the device reported seconds ago.
  expect(motionOnly[0].tone).toBe("warn");
  expect(motionOnly[0].label).toBe("1d");

  const deviceWide = resolveBadges(
    [{ kind: "badge", source: "ago" }],
    {
      controls: [
        { id: "c", feature: "motion", available: true, liveValue: true },
      ],
    },
    time,
    NOW,
  );
  expect(deviceWide[0].tone).toBe("info");
});
