import { describe, expect, it } from "vitest";
import { codeEntries, filterCodeEntries } from "./code-entries";

const formula = {
  id: "f",
  name: "Dew point",
  expr: "1 + 1",
  notes: "Relative humidity",
};
const user = {
  id: "u",
  name: "Snippet",
  description: "Turns a value into text",
  mode: "expression" as const,
  code: "2 + 2",
};
const builtin = {
  id: "b",
  name: "Celsius → Fahrenheit",
  mode: "expression" as const,
  code: "(r, raw) => raw",
};

describe("codeEntries", () => {
  it("combines formulas, user snippets and built-ins", () => {
    const entries = codeEntries([formula], [user], [builtin]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "formula",
      "function",
      "function",
    ]);
    expect(entries.map((entry) => entry.builtin)).toEqual([false, false, true]);
    expect(entries[0].preview).toBe("1 + 1");
    expect(entries.map((entry) => entry.description)).toEqual([
      "Relative humidity",
      "Turns a value into text",
      "",
    ]);
  });
});

describe("filterCodeEntries", () => {
  it("filters by name/preview and sorts by direction", () => {
    const entries = codeEntries([formula], [user], [builtin]);
    expect(
      filterCodeEntries(entries, "dew", "asc").map((entry) => entry.id),
    ).toEqual(["f"]);
    expect(
      filterCodeEntries(entries, "2 + 2", "asc").map((entry) => entry.id),
    ).toEqual(["u"]);
    expect(
      filterCodeEntries(entries, "humidity", "asc").map((entry) => entry.id),
    ).toEqual(["f"]);
    expect(
      filterCodeEntries(entries, "turns a value", "asc").map(
        (entry) => entry.id,
      ),
    ).toEqual(["u"]);
    expect(filterCodeEntries(entries, "", "desc")[0].id).toBe("u");
  });
});
