import { expect, it } from "vitest";
import { adminPageHref } from "./builtin-pages";

it("opens admin overview without a tab query", () => {
  expect(adminPageHref("overview", "/ihome")).toBe("/ihome/#/admin");
});

it("carries the other admin tabs in the hash query", () => {
  expect(adminPageHref("objects")).toBe("/#/admin?tab=objects");
  expect(adminPageHref("enums")).toBe("/#/admin?tab=enums");
});
