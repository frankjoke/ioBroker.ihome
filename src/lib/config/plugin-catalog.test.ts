import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parsePluginFile } from "$adapter/plugin-file";
import { parsePluginCatalog } from "./plugin-catalog";

const entry = {
  id: "nut.ups",
  name: "NUT UPS",
  description: "Network UPS Tools: battery, load and status.",
  version: "1.0.0",
  api: 1,
  file: "nut.ups.json",
};

it("parses a valid catalog and drops junk entries", () => {
  const parsed = parsePluginCatalog({
    version: 1,
    plugins: [
      entry,
      { ...entry, id: "Bad Id" },
      { ...entry },
      { ...entry, id: "missing.name", name: "" },
    ],
  });
  expect(parsed).toEqual({ version: 1, plugins: [entry] });
});

it("refuses a newer catalog and built-in ids", () => {
  expect(parsePluginCatalog({ version: 2, plugins: [entry] })).toBeNull();
  expect(
    parsePluginCatalog(
      { version: 1, plugins: [{ ...entry, id: "network.info" }] },
      ["network.info"],
    ),
  ).toEqual({ version: 1, plugins: [] });
});

it("refuses foreign, traversing and non-json files", () => {
  for (const file of ["https://x/y.json", "../x.json", "sub/x.json", "x.txt"]) {
    expect(
      parsePluginCatalog({ version: 1, plugins: [{ ...entry, file }] })
        ?.plugins,
    ).toEqual([]);
  }
});

it("limits the strings and needs a positive api", () => {
  expect(
    parsePluginCatalog({
      version: 1,
      plugins: [{ ...entry, description: "x".repeat(201) }],
    })?.plugins,
  ).toEqual([]);
  expect(
    parsePluginCatalog({ version: 1, plugins: [{ ...entry, api: 0 }] })
      ?.plugins,
  ).toEqual([]);
  expect(
    parsePluginCatalog(JSON.stringify({ version: 1, plugins: [entry] })),
  ).toEqual({ version: 1, plugins: [entry] });
});

it("ships a valid catalog whose plugin files all parse", () => {
  const catalog = parsePluginCatalog(
    readFileSync("static/plugins/index.json", "utf8"),
  );
  expect(catalog?.version).toBe(1);
  expect(catalog?.plugins.length).toBe(2);
  for (const entry of catalog?.plugins ?? []) {
    const parsed = parsePluginFile(
      JSON.parse(readFileSync(`static/plugins/${entry.file}`, "utf8")),
    );
    expect("problem" in parsed).toBe(false);
    if ("plugin" in parsed) {
      expect(parsed.plugin.id).toBe(entry.id);
      expect(parsed.plugin.api).toBe(1);
      expect(parsed.plugin.version).toBe(entry.version);
    }
  }
});
