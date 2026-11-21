import { describe, expect, it } from "vitest";
import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import { codeEntries } from "./code-entries";

const plugin = { id: "ext", name: "Ext", enabled: true };
const formula: FormulaTemplate = { id: "f", name: "Formula", expr: "1 + 1" };
const fn: FunctionTemplate = {
  id: "fn",
  name: "Function",
  mode: "statements",
  code: "x",
};

describe("codeEntries", () => {
  it("sources plugin formulas and functions with provenance", () => {
    const entries = codeEntries(
      [],
      [],
      [],
      [{ key: "plugin:ext:formulas:f", plugin, value: formula }],
      [{ key: "plugin:ext:functions:fn", plugin, value: fn }],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "formula",
        id: "f",
        preview: "1 + 1",
        builtin: false,
        key: "plugin:ext:formulas:f",
        plugin,
      }),
      expect.objectContaining({
        kind: "function",
        id: "fn",
        preview: "x",
        builtin: false,
        key: "plugin:ext:functions:fn",
        plugin,
      }),
    ]);
    expect(entries[0].search).toContain("ext");
    expect(entries[1].search).toContain("ext");
  });

  it("keeps the built-in and user order unchanged", () => {
    const entries = codeEntries(
      [formula],
      [fn],
      [{ ...fn, id: "builtin", name: "Builtin" }],
    );
    expect(entries.map((entry) => entry.id)).toEqual(["f", "fn", "builtin"]);
    expect(entries.map((entry) => entry.builtin)).toEqual([false, false, true]);
  });
});
