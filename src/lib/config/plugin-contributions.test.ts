import { describe, expect, it } from "vitest";
import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";
import { BUILTIN_TEMPLATES } from "$logic/templates";
import {
  contributionKey,
  readPluginContributions,
} from "./plugin-contributions";

const tile = {
  id: "pair",
  name: "Pair",
  type: "Custom",
  features: [],
  slots: [],
} as unknown as Template;
const bundle = {
  id: "b",
  name: "Bundle",
  device: { type: "Custom", features: [], slots: [] },
} as unknown as TemplateBundle;
const logic = BUILTIN_TEMPLATES[0];
const formula = {
  id: "f",
  name: "Formula",
  expr: "1 + 1",
} as FormulaTemplate;
const fn = {
  id: "fn",
  name: "Function",
  mode: "statements",
  code: "x",
} as FunctionTemplate;
const snippet = { id: "s", name: "Snippet", code: "x" };

describe("contributionKey", () => {
  it("is stable and includes plugin, kind and item", () => {
    expect(contributionKey("external-access", "tiles", "opencode-pair")).toBe(
      "plugin:external-access:tiles:opencode-pair",
    );
  });
});

describe("readPluginContributions", () => {
  it("sources every kind with its plugin", () => {
    const set = readPluginContributions({
      plugins: [
        {
          id: "ext",
          name: "Ext",
          enabled: true,
          contributions: {
            tiles: [tile],
            bundles: [bundle],
            logic: [logic],
            formulas: [formula],
            functions: [fn],
            snippets: [snippet],
          },
        },
        {
          id: "off",
          name: "Off",
          enabled: false,
          contributions: { snippets: [snippet] },
        },
      ],
    });
    expect(set.tiles).toHaveLength(1);
    expect(set.tiles[0].key).toBe("plugin:ext:tiles:pair");
    expect(set.tiles[0].plugin).toEqual({
      id: "ext",
      name: "Ext",
      enabled: true,
    });
    expect(set.bundles[0].value).toBe(bundle);
    expect(set.logic[0].value).toBe(logic);
    expect(set.formulas[0].value).toBe(formula);
    expect(set.functions[0].value).toBe(fn);
    expect(set.snippets[0].value).toBe(snippet);
    expect(set.snippets.some((entry) => entry.plugin.id === "off")).toBe(true);
    expect(set.problems).toEqual([]);
  });

  it("hides an invalid item and keeps its siblings", () => {
    const set = readPluginContributions({
      plugins: [
        {
          id: "bad",
          name: "Bad",
          enabled: true,
          contributions: {
            tiles: [{ ...tile, type: "Nope" }],
            snippets: [snippet],
          },
        },
      ],
    });
    expect(set.tiles).toEqual([]);
    expect(set.snippets).toHaveLength(1);
    expect(set.problems[0]).toMatch(/Bad.*tile.*type/i);
  });

  it("rejects invalid logic, bundle, formula, function and snippet items", () => {
    const set = readPluginContributions({
      plugins: [
        {
          id: "bad",
          name: "Bad",
          enabled: true,
          contributions: {
            bundles: [{ id: "b", name: "B" }],
            logic: [{ id: "l", name: "L" }],
            formulas: [{ id: "f", name: "F" }],
            functions: [{ id: "fn", name: "Fn" }],
            snippets: [{ id: "s", name: "S" }],
          },
        },
      ],
    });
    expect(set.bundles).toEqual([]);
    expect(set.logic).toEqual([]);
    expect(set.formulas).toEqual([]);
    expect(set.functions).toEqual([]);
    expect(set.snippets).toEqual([]);
    expect(set.problems.length).toBe(5);
  });

  it("keeps a plugin problem as a message", () => {
    const set = readPluginContributions({
      plugins: [
        {
          id: "broken",
          name: "Broken",
          enabled: true,
          contributions: {},
          problem: "plugins/broken/plugin.json is missing.",
        },
      ],
    });
    expect(set.problems[0]).toContain("plugin.json is missing");
  });

  it("does not throw on a malformed reply", () => {
    expect(readPluginContributions(null).tiles).toEqual([]);
    expect(readPluginContributions({ plugins: "nope" }).problems).not.toEqual(
      [],
    );
    expect(
      readPluginContributions({ plugins: [{ id: 1, contributions: 2 }] })
        .problems,
    ).not.toEqual([]);
  });
});
