import { expect, it } from "vitest";
import { deleteTitle } from "./delete-title";

it("names what is deleted", () => {
  expect(deleteTitle("logic", "Hallway")).toBe("Delete logic “Hallway”");
  expect(deleteTitle("device", "Plug")).toBe("Delete device “Plug”");
});

it("names where it is deleted from", () => {
  expect(deleteTitle("state", "On", { kind: "logic", name: "Hallway" })).toBe(
    "Delete state “On” from logic “Hallway”",
  );
  expect(deleteTitle("event", "motion", { kind: "state", name: "On" })).toBe(
    "Delete event “motion” from state “On”",
  );
});
