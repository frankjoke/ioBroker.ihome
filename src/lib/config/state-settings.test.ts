import { describe, expect, it } from "vitest";
import {
  chartPoints,
  deleteAllPayload,
  deleteRangePayload,
  hasHistoryFeature,
  historyFeatures,
  historyKeys,
  instanceOf,
  isHistoryAdapter,
  isHistoryCustom,
  defaultHistoryAdapter,
  restoreSelection,
  stateEntries,
  stateMatches,
} from "./state-settings";
import type { StateEntry } from "./state-settings";
import type { SourceOverride } from "$lib/types/overrides";

const override = (stateId: string): SourceOverride => ({
  id: stateId,
  stateId,
  kind: "repair",
  name: "level",
});

describe("stateEntries", () => {
  it("lists only state objects, sorted, with custom keys and override counts", () => {
    const objects = new Map<string, any>([
      [
        "b",
        {
          type: "state",
          common: {
            name: "Beta",
            role: "level",
            custom: { "history.0": { enabled: true, debounceTime: 0 } },
          },
        },
      ],
      ["a", { type: "state", common: { name: "Alpha", role: "value" } }],
      ["folder", { type: "folder", common: { name: "Folder" } }],
    ]);
    const entries = stateEntries(objects, [override("b")], []);
    expect(entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(entries.find((entry) => entry.id === "b")).toMatchObject({
      name: "Beta",
      role: "level",
      instance: "b",
      historyKeys: ["history.0"],
      overrideCount: 1,
    });
  });

  it("filters by text and badges", () => {
    const entry = {
      id: "0_userdata.0.lamp",
      name: "Lamp",
      type: "number",
      role: "level",
      instance: "0_userdata.0",
      historyKeys: ["history.0"],
      overrideCount: 1,
    };
    expect(stateMatches(entry, "lam", {})).toBe(true);
    expect(stateMatches(entry, "level", {})).toBe(true);
    expect(stateMatches(entry, "nope", {})).toBe(false);
    expect(stateMatches(entry, "", { history: true })).toBe(true);
    expect(stateMatches(entry, "", { override: true })).toBe(true);
    expect(stateMatches(entry, "", { instance: "0_userdata.0" })).toBe(true);
    expect(stateMatches(entry, "", { instance: "ihome.0" })).toBe(false);
    expect(
      stateMatches({ ...entry, overrideCount: 0 }, "", { override: true }),
    ).toBe(false);
  });
});

describe("instances and restore", () => {
  it("groups state ids by adapter instance", () => {
    expect(instanceOf("0_userdata.0.lamp")).toBe("0_userdata.0");
    expect(instanceOf("ihome.0.Variables.x")).toBe("ihome.0");
    expect(instanceOf("system.adapter.history.0.alive")).toBe(
      "system.adapter.history.0",
    );
    expect(instanceOf("system.host.pi.uptime")).toBe("system.host.pi");
    expect(instanceOf("system.certificates")).toBe("system.certificates");
    expect(instanceOf("lonely")).toBe("lonely");
  });

  it("recognises history configs, not other custom entries", () => {
    const custom = {
      "iqontrol.0": { enabled: true },
      "history.0": { enabled: true, debounceTime: 0 },
      "influxdb.0": { enabled: true, changesOnly: false },
      ihome: { overrides: [] },
    };
    expect(isHistoryCustom(custom["iqontrol.0"])).toBe(false);
    expect(historyKeys(custom)).toEqual(["history.0", "influxdb.0"]);
  });

  it("reads the default history adapter from system.config", () => {
    const config = (value: unknown) =>
      new Map<string, any>([
        ["system.config", { common: { defaultHistory: value } }],
      ]);
    expect(defaultHistoryAdapter(config("history.0"))).toBe("history.0");
    expect(defaultHistoryAdapter(config(""))).toBe("");
    expect(defaultHistoryAdapter(config(4))).toBe("");
    expect(defaultHistoryAdapter(new Map())).toBe("");
  });

  it("restores the remembered state, else a sibling, else the first", () => {
    const row = (id: string): StateEntry => ({
      id,
      name: id,
      type: "number",
      role: "value",
      instance: instanceOf(id),
      historyKeys: [],
      overrideCount: 0,
    });
    const rows = [
      row("0_userdata.0.a"),
      row("0_userdata.0.room.lamp"),
      row("ihome.0.x"),
    ];
    expect(restoreSelection(rows, "0_userdata.0.a")).toBe("0_userdata.0.a");
    expect(restoreSelection(rows, "0_userdata.0.room.gone")).toBe(
      "0_userdata.0.room.lamp",
    );
    expect(restoreSelection(rows, "gone.0.x")).toBe("0_userdata.0.a");
    expect(restoreSelection(rows, "")).toBe("0_userdata.0.a");
    expect(restoreSelection([], "x")).toBe("");
  });
});

describe("history adapter helpers", () => {
  const reply = {
    supportedFeatures: ["getHistory", "deleteRange", "deleteAll"],
  };

  it("reads supported features", () => {
    expect(historyFeatures(reply)).toEqual([
      "getHistory",
      "deleteRange",
      "deleteAll",
    ]);
    expect(historyFeatures({ supportedFeatures: "nope" })).toEqual([]);
    expect(hasHistoryFeature(reply, "deleteRange")).toBe(true);
    expect(hasHistoryFeature({}, "deleteAll")).toBe(false);
  });

  it("treats getHistory as the baseline of a history adapter", () => {
    const bare = { supportedFeatures: ["deleteRange", "deleteAll"] };
    expect(isHistoryAdapter(bare)).toBe(true);
    expect(isHistoryAdapter({})).toBe(false);
    expect(hasHistoryFeature(bare, "getHistory")).toBe(true);
    expect(hasHistoryFeature({ supportedFeatures: [] }, "getHistory")).toBe(
      true,
    );
    expect(hasHistoryFeature({}, "getHistory")).toBe(false);
  });

  it("builds the standard delete payloads", () => {
    expect(deleteRangePayload("s", 10, 20)).toEqual([
      { id: "s", start: 10, end: 20 },
    ]);
    expect(deleteAllPayload("s")).toEqual({ id: "s" });
  });

  it("turns numeric and boolean history rows into chart points", () => {
    expect(
      chartPoints([
        { ts: 2, val: false },
        { ts: 1, val: 3 },
        { ts: 3, val: "text" },
      ]),
    ).toEqual([
      { ts: 1, val: 3 },
      { ts: 2, val: 0 },
    ]);
  });
});
