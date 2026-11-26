import { expect, it } from "vitest";
import { resolveStatesTab } from "./states-tabs";

it("resolves the explicit tab, then the remembered one, then States", () => {
  expect(resolveStatesTab("variables")).toBe("variables");
  expect(resolveStatesTab("bogus", "constants")).toBe("constants");
  expect(resolveStatesTab(undefined, undefined)).toBe("states");
  expect(resolveStatesTab(null, "nope")).toBe("states");
});
