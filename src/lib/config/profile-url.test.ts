import { expect, it } from "vitest";
import { profileUrl } from "./profile-url";

it("pins the namespace and keeps the app path", () => {
  expect(profileUrl("http://host:8082/ihome/#/states", "ihome.1")).toBe(
    "http://host:8082/ihome/?namespace=ihome.1#/",
  );
});

it("keeps the other query parameters", () => {
  const url = new URL(
    profileUrl("http://host/ihome/?socket=ws%3A%2F%2Fx#/states", "ihome.1"),
  );
  expect(url.searchParams.get("socket")).toBe("ws://x");
  expect(url.searchParams.get("namespace")).toBe("ihome.1");
});
