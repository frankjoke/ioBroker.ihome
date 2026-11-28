import { describe, expect, it } from "vitest";
import {
  removeStateLabel,
  renameStateLabel,
  setStateLabel,
} from "./state-labels";

describe("state labels", () => {
  it("adds a label and updates an existing one", () => {
    expect(setStateLabel(undefined, "0", "Off")).toEqual({ "0": "Off" });
    expect(setStateLabel({ "0": "Off" }, "0", "Aus")).toEqual({
      "0": "Aus",
    });
    expect(setStateLabel({ "0": "Off" }, "1", "On")).toEqual({
      "0": "Off",
      "1": "On",
    });
  });

  it("ignores an empty key", () => {
    const states = { "0": "Off" };
    expect(setStateLabel(states, " ", "Aus")).toBe(states);
  });

  it("renames a key and keeps its label", () => {
    expect(renameStateLabel({ "0": "Off" }, "0", "1")).toEqual({
      "1": "Off",
    });
    expect(renameStateLabel({ "0": "Off", "1": "On" }, "0", "2")).toEqual({
      "1": "On",
      "2": "Off",
    });
  });

  it("removes the row on an empty key and ignores an unchanged key", () => {
    const states = { "0": "Off" };
    expect(renameStateLabel(states, "0", "0")).toBe(states);
    expect(renameStateLabel(states, "0", " ")).toBeUndefined();
    expect(renameStateLabel({ "0": "Off", "1": "On" }, "0", " ")).toEqual({
      "1": "On",
    });
  });

  it("removes a label and clears the last one", () => {
    expect(removeStateLabel({ "0": "Off", "1": "On" }, "0")).toEqual({
      "1": "On",
    });
    expect(removeStateLabel({ "0": "Off" }, "0")).toBeUndefined();
    expect(removeStateLabel(undefined, "0")).toBeUndefined();
  });
});
