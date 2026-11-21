import { describe, expect, it } from "vitest";
import {
  MAX_CONTRIBUTION,
  MAX_PLUGIN_CONTRIBUTIONS,
  contributionSummary,
  pluginContributionsOf,
} from "./plugin-contributions";

const tile = {
  id: "pair",
  name: "Pair",
  type: "Custom",
  features: [],
  slots: [],
};

function problem(value: unknown): string {
  const result = pluginContributionsOf(value);
  if ("problem" in result) return result.problem;
  throw new Error("expected a problem");
}

describe("pluginContributionsOf", () => {
  it("accepts every contribution kind", () => {
    const value = {
      tiles: [tile],
      bundles: [{ id: "b", name: "Bundle" }],
      logic: [{ id: "l", name: "Logic" }],
      formulas: [{ id: "f", name: "Formula", expr: "1" }],
      functions: [
        { id: "fn", name: "Function", mode: "statements", code: "x" },
      ],
      snippets: [{ id: "s", name: "Snippet", code: "sendTo()" }],
    };
    const result = pluginContributionsOf(value);
    expect("contributions" in result && result.contributions).toEqual(value);
  });

  it("rejects a non-object and an empty object", () => {
    expect(problem(null)).toMatch(/object/i);
    expect(problem([])).toMatch(/object/i);
    expect(problem({})).toMatch(/at least one/i);
  });

  it("rejects unknown keys and empty arrays", () => {
    expect(problem({ other: [tile] })).toMatch(/unknown/i);
    expect(problem({ tiles: [] })).toMatch(/empty/i);
  });

  it("rejects duplicate ids inside one kind", () => {
    expect(problem({ tiles: [tile, { ...tile }] })).toMatch(/duplicate/i);
  });

  it("rejects bad ids and names", () => {
    expect(problem({ tiles: [{ ...tile, id: "bad id" }] })).toMatch(/id/i);
    expect(problem({ tiles: [{ ...tile, name: "" }] })).toMatch(/name/i);
  });

  it("rejects a snippet without code", () => {
    expect(problem({ snippets: [{ id: "s", name: "S" }] })).toMatch(/code/i);
  });

  it("rejects oversized items and totals", () => {
    expect(
      problem({ tiles: [{ ...tile, html: "x".repeat(MAX_CONTRIBUTION + 1) }] }),
    ).toMatch(/large|size/i);
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...tile,
      id: `t${index}`,
      html: "x".repeat(40_000),
    }));
    expect(problem({ tiles: many })).toMatch(/large|size/i);
    expect(MAX_PLUGIN_CONTRIBUTIONS).toBeGreaterThan(0);
  });
});

describe("contributionSummary", () => {
  it("counts each kind and the total", () => {
    expect(
      contributionSummary({
        tiles: [tile, { ...tile, id: "two" }],
        snippets: [{ id: "s", name: "S", code: "x" }],
      }),
    ).toEqual({ counts: { tiles: 2, snippets: 1 }, total: 3 });
  });

  it("is empty for undefined and empty input", () => {
    expect(contributionSummary(undefined)).toEqual({ counts: {}, total: 0 });
    expect(contributionSummary({})).toEqual({ counts: {}, total: 0 });
  });
});
