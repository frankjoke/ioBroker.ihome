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
