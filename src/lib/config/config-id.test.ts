import { expect, it } from "vitest";
import { configId } from "./config-id";

it("builds a document id for the selected instance", () => {
  expect(configId("pageList", "ihome.42")).toBe("ihome.42.config.pageList");
});
