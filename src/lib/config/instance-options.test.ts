import { expect, it } from "vitest";
import { iHomeInstanceIds } from "./instance-options";

it("lists installed iHome instances only", () => {
  const objects = new Map<string, any>([
    ["system.adapter.ihome.0", { type: "instance" }],
    ["system.adapter.ihome.1", { type: "instance" }],
    ["system.adapter.history.0", { type: "instance" }],
  ]);
  expect(iHomeInstanceIds(objects)).toEqual(["ihome.0", "ihome.1"]);
});
