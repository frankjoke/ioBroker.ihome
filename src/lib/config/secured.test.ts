import { expect, it } from "vitest";
import { withoutSecured } from "./secured";

it("drops secured items only outside the local network", () => {
  const items = [{ id: "open" }, { id: "secret", secured: true }];
  expect(withoutSecured(items, true).map((item) => item.id)).toEqual([
    "open",
    "secret",
  ]);
  expect(withoutSecured(items, false).map((item) => item.id)).toEqual(["open"]);
});
