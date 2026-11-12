import { it, expect } from "vitest";
import { templateKind } from "$lib/config/config-nav";

it("maps template deep links to the two groups", () => {
  expect(templateKind("code")).toBe("code");
  expect(templateKind("templates")).toBe("templates");
  expect(templateKind("formula")).toBe("code");
  expect(templateKind("function")).toBe("code");
  expect(templateKind("device")).toBe("templates");
  expect(templateKind("logic")).toBe("templates");
  expect(templateKind("logic-device")).toBe("templates");
  expect(templateKind(null)).toBe("templates");
  expect(templateKind("nope")).toBe("templates");
});
