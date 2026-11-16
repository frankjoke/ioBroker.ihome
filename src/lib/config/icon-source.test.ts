import { it, expect } from "vitest";
import {
  iconSourceChoices,
  importValue,
  keywordsFromPath,
  parseListing,
  sourceEntriesFromDir,
} from "$lib/config/icon-source";

const LISTING = `<a href="./gadgets/">gadgets</a>
<a href="../">..</a>
<a href="./alarm-clock-set.svg">alarm-clock-set.svg</a>
<a href="./notes.txt">notes.txt</a>
<a href="https://example.org/icons/remote.png">remote</a>`;

it("parses a web-adapter directory listing", () => {
  expect(parseListing(LISTING, "http://host:8082/icons-freepic/")).toEqual([
    {
      path: "/icons-freepic/gadgets/",
      label: "gadgets",
      kind: "folder",
    },
    {
      path: "/icons-freepic/alarm-clock-set.svg",
      label: "alarm-clock-set",
      kind: "icon",
    },
  ]);
});

it("parses a picker page that only links images", () => {
  const html = `<table><tr>
    <td><img src="battery/battery_10percent.png" width="64"></td>
    <td><img src="battery/battery_20percent.png" width="64"></td>
  </tr></table>`;
  expect(
    parseListing(html, "http://host:8082/icons-addictive-flavour-png/"),
  ).toEqual([
    {
      path: "/icons-addictive-flavour-png/battery/battery_10percent.png",
      label: "battery_10percent",
      kind: "icon",
    },
    {
      path: "/icons-addictive-flavour-png/battery/battery_20percent.png",
      label: "battery_20percent",
      kind: "icon",
    },
  ]);
});

it("dedupes repeated links and keeps single quotes", () => {
  const html = `<img src='a.svg'><a href="a.svg">a</a>`;
  expect(parseListing(html, "http://host/base/")).toEqual([
    { path: "/base/a.svg", label: "a", kind: "icon" },
  ]);
});

it("takes keywords from the folders below the base", () => {
  expect(
    keywordsFromPath(
      "icons-freepic/",
      "icons-freepic/gadgets/alarm-clock-set.svg",
    ),
  ).toEqual(["gadgets"]);
  expect(
    keywordsFromPath(
      "/icons-addictive-flavour-png/",
      "/icons-addictive-flavour-png/battery/battery_10percent.png",
    ),
  ).toEqual(["battery"]);
  expect(keywordsFromPath("icons-freepic/", "icons-freepic/x.svg")).toEqual([]);
});

it("builds the stored adapter path", () => {
  expect(
    importValue("icons-freepic/", "icons-freepic/gadgets/alarm-clock-set.svg"),
  ).toBe("/icons-freepic/gadgets/alarm-clock-set.svg");
  expect(importValue("icons-freepic/", "/icons-freepic/x.svg")).toBe(
    "/icons-freepic/x.svg",
  );
  expect(
    importValue(
      "icons-freepic/",
      "http://host:8082/icons-freepic/gadgets/x.svg",
    ),
  ).toBe("/icons-freepic/gadgets/x.svg");
  expect(importValue("icons-freepic/", "adapter/icons-freepic/x.svg")).toBe(
    "adapter/icons-freepic/x.svg",
  );
});

it("offers every installed icon adapter as a root source", () => {
  const choices = iconSourceChoices(
    ["icons-freepic", "icons-smarthome", "hue", "icons8", "trash"],
    ["ihome.meta"],
  );
  expect(choices.map((c) => c.path)).toEqual([
    "/icons-freepic/",
    "/icons-smarthome/",
    "/icons8/",
    "/ihome.meta/",
    "/iqontrol/images/",
  ]);
});

it("builds entries from a file-API directory listing", () => {
  const entries = sourceEntriesFromDir("/icons-smarthome/", [
    { file: "bulb.svg", isDir: false },
    { file: "readme.txt", isDir: false },
    { file: "rooms", isDir: true },
    { file: "alarm.svg", isDir: false },
  ]);
  expect(entries).toEqual([
    { path: "/icons-smarthome/rooms/", label: "rooms", kind: "folder" },
    { path: "/icons-smarthome/alarm.svg", label: "alarm", kind: "icon" },
    { path: "/icons-smarthome/bulb.svg", label: "bulb", kind: "icon" },
  ]);
  expect(
    sourceEntriesFromDir("/iqontrol/images/", [{ file: "battery.png", isDir: false }]),
  ).toEqual([
    { path: "/iqontrol/images/battery.png", label: "battery", kind: "icon" },
  ]);
});
