import { expect, it } from "vitest";
import {
  emptyPluginPages,
  parsePluginPages,
  pluginPageHref,
  validPluginPageUrl,
} from "./plugin-pages";

it("parses a valid page list", () => {
  const doc = {
    version: 1,
    pages: [
      {
        id: "iqontrol",
        title: "iqontrol",
        icon: "dashboard",
        url: "/iqontrol/",
        open: "embed",
      },
      {
        id: "grafana",
        title: "Grafana",
        url: "https://grafana.example/",
        open: "tab",
      },
    ],
  };
  expect(parsePluginPages(JSON.stringify(doc))).toEqual({
    version: 1,
    pages: [
      {
        id: "iqontrol",
        title: "iqontrol",
        icon: "dashboard",
        url: "/iqontrol/",
        open: "embed",
      },
      {
        id: "grafana",
        title: "Grafana",
        icon: "web_asset",
        url: "https://grafana.example/",
        open: "tab",
      },
    ],
  });
});

it("accepts only root-relative or http(s) URLs", () => {
  expect(validPluginPageUrl("/ihome/plugin.html")).toBe("/ihome/plugin.html");
  expect(validPluginPageUrl("https://example.com/x")).toBe(
    "https://example.com/x",
  );
  expect(validPluginPageUrl("javascript:alert(1)")).toBeUndefined();
  expect(validPluginPageUrl("relative.html")).toBeUndefined();
  expect(validPluginPageUrl("")).toBeUndefined();
});

it("refuses a duplicate id, an unknown version or an invalid open mode", () => {
  const page = { title: "A", url: "/a", open: "embed" };
  expect(
    parsePluginPages({
      version: 1,
      pages: [
        { ...page, id: "a" },
        { ...page, id: "a", title: "B" },
      ],
    }),
  ).toBeNull();
  expect(parsePluginPages({ version: 2, pages: [] })).toBeNull();
  expect(
    parsePluginPages({
      version: 1,
      pages: [{ ...page, id: "a", open: "window" }],
    }),
  ).toBeNull();
});

it("normalizes an empty page list and builds the hash route", () => {
  expect(emptyPluginPages()).toEqual({ version: 1, pages: [] });
  expect(pluginPageHref("iqontrol")).toBe("/#/plugin/iqontrol");
  expect(pluginPageHref("iqontrol", "/ihome")).toBe("/ihome/#/plugin/iqontrol");
});
