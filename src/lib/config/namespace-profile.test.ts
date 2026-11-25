import { expect, it } from "vitest";
import { resolveNamespace } from "./namespace-profile";

it("query wins when it is a valid iHome instance", () => {
  expect(resolveNamespace("ihome.1", "ihome.0", "ihome.0")).toBe("ihome.1");
});
it("ignores invalid query and uses stored", () => {
  expect(resolveNamespace("admin.0", "ihome.2", "ihome.0")).toBe("ihome.2");
});
it("falls back when both are invalid", () => {
  expect(resolveNamespace("", "iHome", "ihome.0")).toBe("ihome.0");
});
it("trims and accepts only ihome.<digits>", () => {
  expect(resolveNamespace(" ihome.3 ", "", "ihome.0")).toBe("ihome.3");
  expect(resolveNamespace("ihome.x", "", "ihome.0")).toBe("ihome.0");
});
